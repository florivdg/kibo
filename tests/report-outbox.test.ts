import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

import { reports } from '@/actions/reports'
import { member, reportNotification } from '@/db/schema'
import type { Mail } from '@/lib/mail/mailer'
import { dispatchReportMails, REPORT_MAIL_ATTEMPTS } from '@/lib/reports/outbox'

import { signedInContext } from './helpers/actions'
import {
  addTestMember,
  insertTestNote,
  newOwnedKita,
  newTestBoard,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
} from './helpers/fixtures'
import { casesOf, fileTestReport, notificationsOf } from './helpers/reports'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// The mails about reported notes (src/lib/reports/outbox.ts): one to every
// owner and admin of the Kita, each on their own, nothing of the note in
// them, at most one an hour per recipient and Kita with the rest collected,
// failed deliveries tried again a few times. The runs only look at the
// Kitas of the test (`only`), and the mails go to the test instead of a mail
// server.

const kitas: string[] = []
const users: string[] = []

const NOTE_TEXT = 'Geheime Telefonnummer 0170 7654321'
const REMARKS = 'Bitte sofort entfernen, das ist meine Nummer'

async function newKita() {
  const { organizationId, owner } = await newOwnedKita()
  const admin = await newTestUser()
  await addTestMember(organizationId, admin.id, 'admin')
  kitas.push(organizationId)
  users.push(owner.id, admin.id)
  const target = await newTestBoard(organizationId)
  const newNote = () =>
    insertTestNote(target.id, { title: 'Verkaufe Rad', body: NOTE_TEXT })
  return { organizationId, owner, admin, link: target.link, newNote }
}

async function reported(kita: Awaited<ReturnType<typeof newKita>>) {
  const noteId = await kita.newNote()
  await fileTestReport(kita.link, noteId, {
    reason: 'personal-data',
    remarks: REMARKS,
  })
  return noteId
}

// A mail server that takes everything, refuses everything, or refuses the
// first n
function mailServer(refuse: number = 0) {
  const sent: Mail[] = []
  let calls = 0
  return {
    sent,
    get calls() {
      return calls
    },
    send: async (mail: Mail) => {
      calls += 1
      if (calls <= refuse) return false
      sent.push(mail)
      return true
    },
  }
}

const HOUR = 60 * 60_000
const later = (from: Date, ms: number) => new Date(from.getTime() + ms)

function run(
  organizationId: string,
  now: Date,
  send: (mail: Mail) => Promise<boolean>,
) {
  return dispatchReportMails({
    only: [organizationId],
    send,
    clock: () => now,
  })
}

beforeEach(resetSpamCounters)

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('dispatchReportMails', () => {
  test('mails every owner and admin on their own, with a link and nothing of the note', async () => {
    const kita = await newKita()
    await reported(kita)
    const [found] = await casesOf(kita.organizationId)
    const server = mailServer()

    await run(kita.organizationId, new Date(), server.send)

    expect(server.sent.map((mail) => mail.to).toSorted()).toEqual(
      [kita.owner.email, kita.admin.email].toSorted(),
    )
    for (const mail of server.sent) {
      expect(mail.subject).toBe('Kibo: Neuer gemeldeter Zettel')
      expect(mail.text).toContain(
        `http://localhost:4321/admin/reports/${found!.id}`,
      )
      expect(mail.text).toContain('ein Zettel gemeldet')
      expect(mail.text).toContain('ob der Zettel hängen bleiben kann')
      for (const part of [mail.text, mail.html]) {
        expect(part).not.toContain('0170')
        expect(part).not.toContain('Verkaufe Rad')
        expect(part).not.toContain('meine Nummer')
      }
    }
    const rows = await notificationsOf(kita.organizationId)
    expect(rows.map((row) => row.status)).toEqual(['sent', 'sent'])

    // Nothing left to send
    await run(kita.organizationId, new Date(), server.send)
    expect(server.sent).toHaveLength(2)
  })

  test('another report of the open case mails nobody again', async () => {
    const kita = await newKita()
    const noteId = await reported(kita)
    const server = mailServer()
    await run(kita.organizationId, new Date(), server.send)
    await fileTestReport(kita.link, noteId)
    await run(kita.organizationId, later(new Date(), 2 * HOUR), server.send)
    expect(server.sent).toHaveLength(2)
  })

  test('whoever left the Kita in between gets nothing', async () => {
    const kita = await newKita()
    await reported(kita)
    await testDb
      .delete(member)
      .where(
        and(
          eq(member.organizationId, kita.organizationId),
          eq(member.userId, kita.admin.id),
        ),
      )
    const server = mailServer()
    await run(kita.organizationId, new Date(), server.send)
    expect(server.sent.map((mail) => mail.to)).toEqual([kita.owner.email])
    const rows = await notificationsOf(kita.organizationId)
    const admin = rows.find((row) => row.userId === kita.admin.id)
    expect(admin?.status).toBe('skipped')
  })

  test('a case that was closed before its mail went out needs no mail', async () => {
    const kita = await newKita()
    await reported(kita)
    const [found] = await casesOf(kita.organizationId)
    await reports.close.orThrow.call(
      signedInContext(kita.owner.id, kita.organizationId),
      { caseId: found!.id, removeNote: true },
    )
    const server = mailServer()
    await run(kita.organizationId, new Date(), server.send)
    expect(server.sent).toEqual([])
  })

  test('collects the cases of the next hour into one mail instead of dropping them', async () => {
    const kita = await newKita()
    const server = mailServer()
    await reported(kita)
    const now = new Date()
    await run(kita.organizationId, now, server.send)
    expect(server.sent).toHaveLength(2)

    // Two more cases a few minutes later: held back, not lost
    await reported(kita)
    await reported(kita)
    const soon = later(now, 5 * 60_000)
    await run(kita.organizationId, soon, server.send)
    expect(server.sent).toHaveLength(2)
    const waiting = (await notificationsOf(kita.organizationId)).filter(
      (row) => row.status === 'pending',
    )
    expect(waiting).toHaveLength(4)
    // Waiting doesn't count as an attempt
    expect(waiting.every((row) => row.attempts === 0)).toBe(true)

    // Once the hour is over, each recipient gets one mail for both
    await run(kita.organizationId, later(now, HOUR + 60_000), server.send)
    const collected = server.sent.slice(2)
    expect(collected.map((mail) => mail.to).toSorted()).toEqual(
      [kita.owner.email, kita.admin.email].toSorted(),
    )
    for (const mail of collected) {
      expect(mail.text).toContain('2 Zettel gemeldet')
      expect(mail.text).toContain('ob die Zettel hängen bleiben können')
      expect(mail.text).toContain('Die Zettel bleiben sichtbar')
      expect(mail.text).not.toContain('Der Zettel')
      expect(mail.text).toContain(
        `http://localhost:4321/admin/reports?kita=${kita.organizationId}`,
      )
    }
  })

  test('tries a failed delivery again later, a limited number of times', async () => {
    const kita = await newKita()
    await reported(kita)
    // Only the owner, to follow one row
    await testDb
      .delete(member)
      .where(
        and(
          eq(member.organizationId, kita.organizationId),
          eq(member.userId, kita.admin.id),
        ),
      )
    const down = mailServer(Number.POSITIVE_INFINITY)
    let now = new Date()
    await run(kita.organizationId, now, down.send)
    const ownerRow = async () =>
      (await notificationsOf(kita.organizationId)).find(
        (row) => row.userId === kita.owner.id,
      )!
    let row = await ownerRow()
    expect(row).toMatchObject({ status: 'pending', attempts: 1 })
    expect(row.claimedUntil).toBeNull()
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())

    // Not before the pause is over
    await run(kita.organizationId, later(now, 60_000), down.send)
    expect((await ownerRow()).attempts).toBe(1)

    for (let attempt = 2; attempt <= REPORT_MAIL_ATTEMPTS; attempt++) {
      now = later(row.nextAttemptAt, 1000)
      await run(kita.organizationId, now, down.send)
      row = await ownerRow()
      expect(row.attempts).toBe(attempt)
    }
    expect(row.status).toBe('failed')
    expect(down.calls).toBe(REPORT_MAIL_ATTEMPTS)

    // Given up is given up
    await run(kita.organizationId, later(now, 24 * HOUR), down.send)
    expect(down.calls).toBe(REPORT_MAIL_ATTEMPTS)
    // The case itself waits for the team all the same
    const [found] = await casesOf(kita.organizationId)
    expect(found!.status).toBe('open')
  })

  test('a mail that went through on the second try is sent once', async () => {
    const kita = await newKita()
    await reported(kita)
    const flaky = mailServer(2)
    const now = new Date()
    await run(kita.organizationId, now, flaky.send)
    expect(flaky.sent).toEqual([])
    const [first] = await notificationsOf(kita.organizationId)
    await run(
      kita.organizationId,
      later(first!.nextAttemptAt, 1000),
      flaky.send,
    )
    expect(flaky.sent.map((mail) => mail.to).toSorted()).toEqual(
      [kita.owner.email, kita.admin.email].toSorted(),
    )
    const rows = await notificationsOf(kita.organizationId)
    expect(rows.map((row) => row.status)).toEqual(['sent', 'sent'])
  })

  test('parallel runs send every mail once', async () => {
    const kita = await newKita()
    await reported(kita)
    const server = mailServer()
    const now = new Date()
    await Promise.all(
      Array.from({ length: 4 }, () =>
        run(kita.organizationId, now, server.send),
      ),
    )
    expect(server.sent.map((mail) => mail.to).toSorted()).toEqual(
      [kita.owner.email, kita.admin.email].toSorted(),
    )
  })

  test('rows a process left claimed when it died are taken up once the claim ran out', async () => {
    const kita = await newKita()
    await reported(kita)
    const now = new Date()
    // A process claimed them and never came back
    await testDb
      .update(reportNotification)
      .set({ claimedUntil: later(now, 10 * 60_000), attempts: 1 })
      .where(eq(reportNotification.organizationId, kita.organizationId))
    const server = mailServer()
    await run(kita.organizationId, now, server.send)
    expect(server.sent).toEqual([])
    await run(kita.organizationId, later(now, 11 * 60_000), server.send)
    expect(server.sent).toHaveLength(2)
  })

  test('a recipient another process is mailing gets no second mail within the hour', async () => {
    const kita = await newKita()
    await reported(kita)
    // Another process claimed the owner's row and is sending it this moment
    await testDb
      .update(reportNotification)
      .set({ claimedUntil: later(new Date(), 10 * 60_000), attempts: 1 })
      .where(
        and(
          eq(reportNotification.organizationId, kita.organizationId),
          eq(reportNotification.userId, kita.owner.id),
        ),
      )
    // A new case comes in meanwhile
    await reported(kita)
    const now = new Date()
    const server = mailServer()
    await run(kita.organizationId, now, server.send)

    // The admin gets one mail for both, the owner nothing yet
    expect(server.sent.map((mail) => mail.to)).toEqual([kita.admin.email])
    const ownerRows = async () =>
      (await notificationsOf(kita.organizationId)).filter(
        (row) => row.userId === kita.owner.id,
      )
    const waiting = (await ownerRows()).filter((row) => row.attempts === 0)
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ status: 'pending', claimedUntil: null })

    // The other process is done: its mail counts for the hour
    await testDb
      .update(reportNotification)
      .set({ status: 'sent', sentAt: now, claimedUntil: null })
      .where(
        and(
          eq(reportNotification.organizationId, kita.organizationId),
          eq(reportNotification.userId, kita.owner.id),
          eq(reportNotification.attempts, 1),
        ),
      )
    await run(kita.organizationId, later(now, 60_000), server.send)
    expect(server.sent).toHaveLength(1)
    expect((await ownerRows()).find((row) => row.attempts === 0)?.status).toBe(
      'pending',
    )

    // Once the hour is over, the waiting case goes out
    await run(kita.organizationId, later(now, HOUR + 2 * 60_000), server.send)
    expect(server.sent.map((mail) => mail.to)).toEqual([
      kita.admin.email,
      kita.owner.email,
    ])
  })

  test('each recipient is claimed and marked with the time it is handled, not when the run began', async () => {
    const kita = await newKita()
    await reported(kita)
    const start = new Date()
    let now = start
    // Every mail takes the mail server twenty minutes; what each claim
    // runs out at is noted while its mail is on the way
    const claims: number[] = []
    const slow = async () => {
      const held = (await notificationsOf(kita.organizationId)).filter(
        (row) => row.claimedUntil,
      )
      claims.push(...held.map((row) => row.claimedUntil!.getTime()))
      now = later(now, 20 * 60_000)
      return true
    }
    await dispatchReportMails({
      only: [kita.organizationId],
      send: slow,
      clock: () => now,
    })
    const sentAt = (await notificationsOf(kita.organizationId))
      .map((row) => row.sentAt!.getTime())
      .toSorted((a, b) => a - b)
    expect(sentAt).toEqual([
      later(start, 20 * 60_000).getTime(),
      later(start, 40 * 60_000).getTime(),
    ])
    // The second claim lasts its full time from when it was made
    expect(claims).toEqual([
      later(start, 15 * 60_000).getTime(),
      later(start, 35 * 60_000).getTime(),
    ])
  })
})
