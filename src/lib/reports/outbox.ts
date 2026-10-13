import { BETTER_AUTH_URL } from 'astro:env/server'
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  member,
  organization,
  reportCase,
  reportNotification,
  user,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { errorMessage } from '@/lib/error-message'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import { noteReportMail } from '@/lib/mail/templates'
import { settleWithin } from '@/lib/server/settle-within'
import { REPORT_MAIL_INTERVAL_MS } from '@/lib/spam/budgets'
import { countSpamEvent } from '@/lib/spam/metrics'

import { handlesReports } from './access'
import { reportCasePath, reportsPath } from './paths'

// The mails about reported notes. The rows are written with the case
// (src/lib/reports/mutations.ts), one per case and owner or admin of the
// Kita, so nothing is lost when the mail server is down or the process
// restarts. This works them off: right after the report is committed
// (reportMailer.schedule), and every few minutes for whatever is due again
// (reportMailer.start, from src/lib/server/runtime.ts).
//
// - Every recipient gets a mail of their own, and only while they are still
//   an owner or admin of the Kita: whoever left in between gets nothing.
// - The mail says that something was reported, and where to look; never
//   what the note or the report said (noteReportMail).
// - A recipient gets one mail an hour per Kita (REPORT_MAIL_INTERVAL_MS).
//   Cases that come in between wait and go out together in the next one.
// - Rows are claimed before the mail goes out, all due rows of one Kita and
//   recipient at once and never while another run holds rows of the pair
//   (claim): of two processes, one sends and the other leaves the pair
//   alone, so the second mail can't overtake the hour. The claim runs out
//   after CLAIM_MINUTES: a process that dies on the way leaves the rows to
//   the next sweep. A mail the server took just before such a death goes out
//   a second time — a mail that never goes out can't happen.
// - A delivery the mail server refused is tried again after a growing pause,
//   MAX_ATTEMPTS times in all; then the row is given up (status `failed`)
//   and the case waits on the admin pages all the same.

// Longer than a mail server may take to answer (nodemailer gives up after
// ten minutes of silence)
const CLAIM_MINUTES = 15
// The pause after the first, second … failed delivery
const RETRY_MINUTES = [5, 15, 60, 240]
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1
// Recipients one run takes on; the next run takes the rest
const RUN_RECIPIENTS = 50
// How often the sweep looks for rows that are due again
const SWEEP_INTERVAL_MS = 5 * 60_000

const MINUTE = 60_000

export interface OutboxOptions {
  // The database the run works on
  on?: Executor
  // How a mail goes out: true once the mail server has it, as sendMail says
  send?: (mail: Mail) => Promise<boolean>
  // Only the rows of these Kitas: the one a report just came in for, or the
  // tests' own
  only?: string[]
  // What time it is. Asked afresh for every step: a run can take a while,
  // one mail server answer after the other. The tests stop it.
  clock?: () => Date
}

type Run = Required<Pick<OutboxOptions, 'on' | 'send' | 'clock'>>

interface Claimed {
  id: string
  caseId: string
  attempts: number
}

function later(now: Date, minutes: number) {
  return new Date(now.getTime() + minutes * MINUTE)
}

// A row is up for a run: waiting, due, and not held by anyone
function due(now: Date) {
  return and(
    eq(reportNotification.status, 'pending'),
    lte(reportNotification.nextAttemptAt, now),
    or(
      isNull(reportNotification.claimedUntil),
      lt(reportNotification.claimedUntil, now),
    ),
  )
}

// Who has mails waiting, by Kita and recipient, longest waiting first
async function dueRecipients(on: Executor, now: Date, only?: string[]) {
  return on
    .select({
      organizationId: reportNotification.organizationId,
      userId: reportNotification.userId,
    })
    .from(reportNotification)
    .where(
      and(due(now), only && inArray(reportNotification.organizationId, only)),
    )
    .groupBy(reportNotification.organizationId, reportNotification.userId)
    .orderBy(sql`min(${reportNotification.nextAttemptAt})`)
    .limit(RUN_RECIPIENTS)
}

// Takes the recipient's due rows for this run, counting the attempt — or
// nothing while another run holds rows of the same Kita and recipient. A
// transaction-scoped advisory lock on the pair lets one claim at a time look
// and take, so two processes can't both find the pair free. The rows that
// wait meanwhile are claimed after the other run is done, and find its mail
// recent (lastMailAt). The rows come back with the moment the claim runs
// out, which is also what tells this run's rows from anyone else's
// afterwards.
async function claim(
  on: Executor,
  organizationId: string,
  userId: string,
  now: Date,
) {
  const claimedUntil = later(now, CLAIM_MINUTES)
  const pair = and(
    eq(reportNotification.organizationId, organizationId),
    eq(reportNotification.userId, userId),
  )
  const rows = await on.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`report-mail|${organizationId}|${userId}`}, 0))`,
    )
    const [held] = await tx
      .select({ id: reportNotification.id })
      .from(reportNotification)
      .where(
        and(
          pair,
          eq(reportNotification.status, 'pending'),
          gte(reportNotification.claimedUntil, now),
        ),
      )
      .limit(1)
    if (held) return []
    return tx
      .update(reportNotification)
      .set({
        claimedUntil,
        attempts: sql`${reportNotification.attempts} + 1`,
      })
      .where(and(pair, due(now)))
      .returning({
        id: reportNotification.id,
        caseId: reportNotification.caseId,
        attempts: reportNotification.attempts,
      })
  })
  return { rows, claimedUntil }
}

// The rows of this run, as long as the claim is still its own
function ours(rows: Claimed[], claimedUntil: Date) {
  return and(
    inArray(
      reportNotification.id,
      rows.map(({ id }) => id),
    ),
    eq(reportNotification.claimedUntil, claimedUntil),
  )
}

async function finish(
  on: Executor,
  rows: Claimed[],
  claimedUntil: Date,
  status: 'sent' | 'skipped',
  now: Date,
) {
  if (!rows.length) return
  await on
    .update(reportNotification)
    .set({
      status,
      claimedUntil: null,
      sentAt: status === 'sent' ? now : null,
    })
    .where(ours(rows, claimedUntil))
}

// Held back because the recipient had a mail lately: back into the queue for
// when the hour is over, without the attempt counting
async function postpone(
  on: Executor,
  rows: Claimed[],
  claimedUntil: Date,
  until: Date,
) {
  await on
    .update(reportNotification)
    .set({
      claimedUntil: null,
      nextAttemptAt: until,
      attempts: sql`${reportNotification.attempts} - 1`,
    })
    .where(ours(rows, claimedUntil))
}

// The mail did not go out: each row again after its pause, or given up once
// it has had all its attempts. The log names the account only, never a case.
async function retryLater(
  on: Executor,
  userId: string,
  rows: Claimed[],
  claimedUntil: Date,
  now: Date,
) {
  const spent = rows.filter((row) => row.attempts >= MAX_ATTEMPTS)
  if (spent.length < rows.length) {
    console.warn(
      `[reports] Mail zu Meldungen an Konto ${userId} nicht verschickt, neuer Versuch folgt`,
    )
  }
  if (spent.length) {
    countSpamEvent('report:mail-given-up', spent.length)
    console.warn(
      `[reports] Mail zu Meldungen an Konto ${userId} nicht verschickt, aufgegeben`,
    )
    await on
      .update(reportNotification)
      .set({ status: 'failed', claimedUntil: null })
      .where(ours(spent, claimedUntil))
  }
  for (const attempts of new Set(rows.map((row) => row.attempts))) {
    if (attempts >= MAX_ATTEMPTS) continue
    await on
      .update(reportNotification)
      .set({
        claimedUntil: null,
        nextAttemptAt: later(now, RETRY_MINUTES[attempts - 1]!),
      })
      .where(
        ours(
          rows.filter((row) => row.attempts === attempts),
          claimedUntil,
        ),
      )
  }
}

// When the recipient last got a mail about this Kita's reports, if they did
// within the throttle's time: the rows remember it until their case goes
async function lastMailAt(
  on: Executor,
  organizationId: string,
  userId: string,
) {
  const [row] = await on
    .select({ at: sql<Date | null>`max(${reportNotification.sentAt})` })
    .from(reportNotification)
    .where(
      and(
        eq(reportNotification.organizationId, organizationId),
        eq(reportNotification.userId, userId),
        eq(reportNotification.status, 'sent'),
      ),
    )
  return row?.at ? new Date(row.at) : undefined
}

// The recipient as they are now: still an owner or admin of the Kita, with
// the address and name the mail goes to. Undefined for someone who left.
async function currentRecipient(
  on: Executor,
  organizationId: string,
  userId: string,
) {
  const [found] = await on
    .select({
      email: user.email,
      name: user.name,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, userId),
        handlesReports(),
      ),
    )
    .limit(1)
  return found
}

// Of the claimed rows, the ones whose case still waits for someone. A case
// that was closed in the meantime needs no mail any more.
async function openOnes(on: Executor, rows: Claimed[]) {
  const open = await on
    .select({ id: reportCase.id })
    .from(reportCase)
    .where(
      and(
        inArray(
          reportCase.id,
          rows.map(({ caseId }) => caseId),
        ),
        eq(reportCase.status, 'open'),
      ),
    )
  const ids = new Set(open.map(({ id }) => id))
  return {
    open: rows.filter((row) => ids.has(row.caseId)),
    closed: rows.filter((row) => !ids.has(row.caseId)),
  }
}

// One case leads to its page, several to the overview — both switch to the
// Kita first when another one is active
function mailLink(organizationId: string, open: Claimed[]) {
  const path =
    open.length === 1
      ? reportCasePath(open[0]!.caseId)
      : reportsPath(organizationId)
  return new URL(path, BETTER_AUTH_URL).href
}

async function sendTo(
  recipient: NonNullable<Awaited<ReturnType<typeof currentRecipient>>>,
  organizationId: string,
  open: Claimed[],
  send: Run['send'],
) {
  try {
    const sent = await send({
      to: recipient.email,
      ...noteReportMail(recipient.name, {
        organizationName: recipient.organizationName,
        count: open.length,
        url: mailLink(organizationId, open),
      }),
    })
    return sent === true
  } catch (error) {
    console.error(`[reports] Versand fehlgeschlagen: ${errorMessage(error)}`)
    return false
  }
}

// One recipient of one Kita: claim what is due, drop what nobody needs any
// more, wait if the last mail is recent, send one mail for all of it and
// note how it went. The clock is read at each step, so a claim lasts its
// full time from when it was made and the hour counts from when the mail
// went out, however long the run took before.
async function deliver(
  organizationId: string,
  userId: string,
  { on, send, clock }: Run,
) {
  const { rows, claimedUntil } = await claim(
    on,
    organizationId,
    userId,
    clock(),
  )
  if (!rows.length) return
  const recipient = await currentRecipient(on, organizationId, userId)
  if (!recipient) return finish(on, rows, claimedUntil, 'skipped', clock())
  const { open, closed } = await openOnes(on, rows)
  await finish(on, closed, claimedUntil, 'skipped', clock())
  if (!open.length) return

  const last = await lastMailAt(on, organizationId, userId)
  const next = last && new Date(last.getTime() + REPORT_MAIL_INTERVAL_MS)
  if (next && next > clock()) {
    countSpamEvent('report:mail-throttled')
    return postpone(on, open, claimedUntil, next)
  }
  if (await sendTo(recipient, organizationId, open, send)) {
    countSpamEvent('report:mail-sent')
    return finish(on, open, claimedUntil, 'sent', clock())
  }
  // The mailer has logged why; the case itself says nothing in the log
  countSpamEvent('report:mail-failed')
  await retryLater(on, userId, open, claimedUntil, clock())
}

// Works off whatever is due, one recipient after the other. A recipient that
// fails is logged by account id and doesn't stop the rest.
export async function dispatchReportMails({
  on = db,
  send = sendMail,
  only,
  clock = () => new Date(),
}: OutboxOptions = {}) {
  let recipients: Awaited<ReturnType<typeof dueRecipients>>
  try {
    recipients = await dueRecipients(on, clock(), only)
  } catch (error) {
    console.error(
      `[reports] Versandlauf fehlgeschlagen: ${errorMessage(error)}`,
    )
    return
  }
  for (const { organizationId, userId } of recipients) {
    try {
      await deliver(organizationId, userId, { on, send, clock })
    } catch (error) {
      console.error(
        `[reports] Versand an Konto ${userId} fehlgeschlagen: ${errorMessage(error)}`,
      )
    }
  }
}

// The app's one outbox runner. Runs one after the other in this process, so
// a report coming in while the sweep is under way waits for it; several
// processes share the rows through the claims, a pair at a time.
function createReportMailer() {
  let tail = Promise.resolve()
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  function enqueue(only?: string[]) {
    if (stopped) return
    tail = tail
      .then(() => dispatchReportMails({ only }))
      .catch((error: unknown) => {
        console.error(
          `[reports] Versandlauf fehlgeschlagen: ${errorMessage(error)}`,
        )
      })
  }

  return {
    // A report was committed and created a case: its mails go out now,
    // without the visitor's request waiting for them
    schedule(organizationId: string) {
      enqueue([organizationId])
    },
    // The sweep, at start-up and every few minutes after. unref: the timer
    // alone must not keep the process alive.
    start() {
      if (stopped || timer) return
      timer = setInterval(() => enqueue(), SWEEP_INTERVAL_MS).unref()
      enqueue()
    },
    // SIGTERM, and the tests: nothing new starts
    stop() {
      stopped = true
      clearInterval(timer)
    },
    // Waits for the run under way, but no longer than the server waits for
    // its requests; rows it leaves behind are claimed again later
    settle(timeoutMs: number) {
      return settleWithin(tail, timeoutMs)
    },
  }
}

export const reportMailer = createReportMailer()

// Exported for the tests
export const REPORT_MAIL_ATTEMPTS = MAX_ATTEMPTS
