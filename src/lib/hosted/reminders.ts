import { BETTER_AUTH_URL } from 'astro:env/server'

import { db } from '@/db'
import type { Executor } from '@/db/types'
import { SUBSCRIPTION_PATH } from '@/lib/auth-paths'
import { addDays, longDate } from '@/lib/board/time'
import { errorMessage } from '@/lib/error-message'
import { instanceMode } from '@/lib/instance'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import {
  deletionNoticeMail,
  subscriptionEndingMail,
  subscriptionExpiredMail,
  subscriptionPausedMail,
} from '@/lib/mail/templates'

import {
  deletionDueAt,
  deletionHeldThrough,
  dueReminderStage,
  expiryBounds,
  expiryDays,
  subscriptionState,
  type ReminderStage,
} from './state'
import {
  advanceReminderStage,
  confirmDeletionNotice,
  deleteKitasOf,
  deletionClaimStands,
  deleteOwnerlessOrganizations,
  listReminderCandidates,
  type Subscription,
} from './subscriptions'

// What the hosted instance does about subscriptions that end, on the
// server's hourly run (src/lib/server/runtime.ts): it reminds the owner — a
// week before the end, at the end, when the Kitas are paused and two weeks
// before they are deleted — and it deletes the Kitas of an account that let
// all of that pass. The account and its row stay.
//
// Each mail goes out once per period: the row counts how far it got
// (reminder_stage), moving it on is one statement that only one process wins
// (advanceReminderStage), and only then is the mail sent. A reminder that
// could not be sent is logged and not tried again — the alternative is a mail
// that goes out twice. Paying starts the count over.
//
// The announcement of the deletion (stage 4) is the exception, because the
// deletion hangs on it: that it was announced is only written once the mail
// was handed to the mail server (confirmDeletionNotice). Until then the row
// stays at stage 4 without a notice, a later run sends the mail again, and
// nothing is deleted. A process that dies between the mail and the note of
// it sends a second one; a deletion nobody was told about cannot happen.
//
// The operator can hold the deletion (deletion_held_until, `hold-deletion`
// in scripts/admin.ts), after a request to switch providers or to have the
// data erased: until then the announcement is not sent and nothing is
// deleted, while the reminders before it go out as usual. Holding it takes
// back an announcement that went out, so after the hold a new one follows
// and the two weeks count from that.
//
// Never reminded, never deleted: accounts that are free for good, accounts
// that own no Kita, and accounts whose Kitas are gone already.
//
// Without HOSTED nothing here touches the database.

export interface RunOptions {
  // The database the run works on: a transaction in the tests
  on?: Executor
  // How a mail goes out: true once the mail server has it, as sendMail
  // answers. Anything else, a rejection included, is a mail that did not go.
  send?: (mail: Mail) => Promise<boolean>
  // Only these accounts (processSubscriptions) or Kitas (deleteOwnerlessKitas)
  only?: string[]
}

type Candidate = Awaited<ReturnType<typeof listReminderCandidates>>[number]

// What the mails name: which period ended, its last day, and the days that
// follow from it
function reminderFacts({ subscription }: Candidate, now: Date) {
  const bounds = expiryBounds(subscription)
  return {
    ...expiryDays(bounds),
    deletableOn: longDate(bounds.deletableAt),
    // Announced now, the Kitas stay for the two weeks the mail promises
    deletesOn: longDate(deletionDueAt(bounds.deletableAt, now)),
    url: new URL(SUBSCRIPTION_PATH, BETTER_AUTH_URL).href,
  }
}

type Facts = ReturnType<typeof reminderFacts>

const REMINDER_MAILS: Record<
  ReminderStage,
  (name: string, facts: Facts) => Omit<Mail, 'to'>
> = {
  1: subscriptionEndingMail,
  2: subscriptionExpiredMail,
  3: subscriptionPausedMail,
  4: deletionNoticeMail,
}

// The stage was moved on by this process: the mail is its to send. Says
// whether it went out; a failure stays with this one account.
async function sendReminder(
  candidate: Candidate,
  stage: ReminderStage,
  now: Date,
  send: NonNullable<RunOptions['send']>,
) {
  const { userId } = candidate.subscription
  let failure: string | undefined
  try {
    const sent = await send({
      to: candidate.email,
      ...REMINDER_MAILS[stage](candidate.name, reminderFacts(candidate, now)),
    })
    // The mailer has logged why
    if (sent !== true) failure = 'Versand fehlgeschlagen'
  } catch (error) {
    failure = errorMessage(error)
  }
  if (failure !== undefined) {
    console.error(
      `[hosted] Erinnerung ${stage} für Konto ${userId} nicht verschickt: ${failure}`,
    )
    return false
  }
  console.info(`[hosted] Erinnerung ${stage} für Konto ${userId} ausgelöst`)
  return true
}

// The reminder the account is to get now, 0 for none: the one that is due
// and has not gone out — or the announcement of the deletion once more, for
// as long as nothing says that it went out
function pendingReminder(
  { reminderStage, deletionNoticeAt }: Candidate['subscription'],
  due: ReminderStage | 0,
) {
  const unannounced = due === 4 && !deletionNoticeAt
  return due > reminderStage || unannounced ? due : 0
}

// Moves the account on to the stage, which only one process gets to do, and
// sends its mail. The announcement of the deletion is noted once it is out.
async function remind(
  candidate: Candidate,
  stage: ReminderStage,
  now: Date,
  { on, send }: Required<Pick<RunOptions, 'on' | 'send'>>,
) {
  const { subscription } = candidate
  if (!(await advanceReminderStage(on, subscription, stage, now))) return
  // The operator may have held the deletion since the claim, or released it
  // and another run claimed the announcement anew: then it isn't ours to send
  if (stage === 4 && !(await deletionClaimStands(on, subscription, now))) {
    console.info(
      `[hosted] Ankündigung für Konto ${subscription.userId} nicht verschickt: inzwischen geändert`,
    )
    return
  }
  const sent = await sendReminder(candidate, stage, now, send)
  if (!sent || stage !== 4) return
  // Changed in between (paid, set free, held, claimed anew): the next run
  // decides afresh
  if (!(await confirmDeletionNotice(on, subscription, now))) {
    console.warn(
      `[hosted] Ankündigung für Konto ${subscription.userId} nicht vermerkt`,
    )
  }
}

// Whether the operator holds the deletion of the account's Kitas at `now`
// (hold-deletion); said in the log on every run that finds it so
function deletionHeld(subscription: Subscription, now: Date) {
  const heldThrough = deletionHeldThrough(subscription, now)
  if (!heldThrough) return false
  console.info(
    `[hosted] Löschung der Kitas des Kontos ${subscription.userId} angehalten bis ${longDate(heldThrough)}`,
  )
  return true
}

// The deletion, once it was announced long enough ago
async function deleteIfDue(
  subscription: Subscription,
  status: ReturnType<typeof subscriptionState>,
  now: Date,
  on: Executor,
) {
  const announced = subscription.deletionNoticeAt
  if (status.state !== 'deletable' || !announced) return
  if (now < deletionDueAt(status.deletableAt, announced)) return
  const deleted = await deleteKitasOf(on, subscription, now)
  if (deleted !== undefined) {
    console.info(
      `[hosted] Kitas des Kontos ${subscription.userId} gelöscht (${deleted})`,
    )
  }
}

// One account: the reminder that is due and has not gone out, or — when the
// deletion was announced long enough ago — the deletion. Never both: an
// account whose deadline has passed unannounced is told first and keeps its
// Kitas for the two weeks the mail names. Those count from `now`, the moment
// the mail computes its day from, and only once the mail is out.
//
// While the deletion is held, neither: a due announcement waits for the
// hold to end, the reminders before it don't.
async function processAccount(
  candidate: Candidate,
  now: Date,
  { on = db, send = sendMail }: RunOptions,
) {
  const { subscription } = candidate
  const status = subscriptionState(subscription, now)
  const stage = pendingReminder(
    subscription,
    dueReminderStage(status, subscription, now),
  )
  const held = deletionHeld(subscription, now)
  if (stage !== 0 && !(held && stage === 4)) {
    return remind(candidate, stage, now, { on, send })
  }
  if (!held) await deleteIfDue(subscription, status, now, on)
}

// Reminders and deletions for every account that is due, of the ones near or
// past their end (listReminderCandidates). One account after the other; one
// that fails is logged by its id and doesn't stop the rest.
export async function processSubscriptions(
  now: Date,
  options: RunOptions = {},
) {
  if (!instanceMode.hosted) return
  let candidates: Candidate[]
  try {
    candidates = await listReminderCandidates(
      options.on ?? db,
      now,
      options.only,
    )
  } catch (error) {
    console.error(`[hosted] Abo-Lauf fehlgeschlagen: ${errorMessage(error)}`)
    return
  }
  for (const candidate of candidates) {
    try {
      await processAccount(candidate, now, options)
    } catch (error) {
      console.error(
        `[hosted] Abo-Lauf für Konto ${candidate.subscription.userId} fehlgeschlagen: ${errorMessage(error)}`,
      )
    }
  }
}

// A Kita without an owner is left behind when deleting the Kitas of a deleted
// account failed (deleteOwnedOrganizations in src/lib/organization-access.ts).
// Nobody answers for it, nobody pays for it, and the account page had
// announced that it goes: on the hosted instance the hourly run deletes it.
// Only once it is a day old — a Kita that is being created this moment has
// no member yet either.
export async function deleteOwnerlessKitas(
  now: Date,
  { on = db, only }: RunOptions = {},
) {
  if (!instanceMode.hosted) return
  try {
    const deleted = await deleteOwnerlessOrganizations(
      on,
      addDays(now, -1),
      only,
    )
    for (const organizationId of deleted) {
      console.info(`[hosted] Kita ohne Inhaber:in gelöscht: ${organizationId}`)
    }
  } catch (error) {
    console.error(
      `[hosted] Löschen der Kitas ohne Inhaber:in fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
