import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { eq, sql } from 'drizzle-orm'

import { hostedSubscription } from '@/db/schema'
import type { Executor } from '@/db/types'
import { addBerlinDays, addDays, berlinDayEnd } from '@/lib/board/time'
import { processSubscriptions } from '@/lib/hosted/reminders'
import {
  advanceReminderStage,
  confirmDeletionNotice,
  findSubscription,
  grantComplimentary,
  listReminderCandidates,
  revokeComplimentary,
  setPaidUntil,
} from '@/lib/hosted/subscriptions'
import { instanceMode } from '@/lib/instance'
import type { Mail } from '@/lib/mail/mailer'

import {
  addTestMember,
  newOwnedKita,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  rolledBack,
  subscriptionOf,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// The reminders of the hosted instance (src/lib/hosted/reminders.ts): a week
// before a trial or a paid year ends, at the end, when the Kitas are paused
// and before they are deleted — each once per period, to the owner only.
// Against the local PostgreSQL. The run looks at every subscription of the
// database, so it works in a transaction that is rolled back or on the
// accounts of the test alone (`only`), and the mails go to the test instead
// of a mail server.
const kitas: string[] = []
const users: string[] = []

// The trial ends at noon in Berlin on 1 June
const trialEndsAt = new Date('2026-06-01T10:00:00.000Z')
const at = (days: number, hours = 0) =>
  new Date(addDays(trialEndsAt, days).getTime() + hours * 60 * 60 * 1000)

const ABO = 'http://localhost:4321/admin/abo'

// An owner with a Kita, and the subscription the test gives them
async function newOwner(
  values: Partial<typeof hostedSubscription.$inferInsert> = {},
) {
  const { organizationId, owner } = await newOwnedKita()
  kitas.push(organizationId)
  users.push(owner.id)
  await testDb
    .insert(hostedSubscription)
    .values({ userId: owner.id, trialEndsAt, ...values })
  return { ...owner, organizationId }
}

// The mails of a run, instead of a mail server
function outbox() {
  const sent: Mail[] = []
  return {
    sent,
    send: async (mail: Mail) => {
      sent.push(mail)
      return true
    },
    // What went to one account, by subject
    subjectsFor: (email: string) =>
      sent.filter((mail) => mail.to === email).map((mail) => mail.subject),
  }
}

let info: ReturnType<typeof spyOn>
let error: ReturnType<typeof spyOn>

const logged = (spy: ReturnType<typeof spyOn>): string[] =>
  spy.mock.calls.map((call: unknown[]) => String(call[0]))

beforeEach(() => {
  instanceMode.hosted = true
  info = spyOn(console, 'info').mockImplementation(() => {})
  error = spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  instanceMode.hosted = false
  info.mockRestore()
  error.mockRestore()
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('over the life of a trial', () => {
  test('every reminder goes out exactly once, to the owner', async () => {
    const owner = await newOwner()
    // Somebody who helps manage the Kita hears nothing
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(owner.organizationId, admin.id, 'admin')
    const mails = outbox()

    const stages = await rolledBack(async (tx) => {
      const seen: number[] = []
      // Every moment twice: the second run has nothing left to say
      for (const now of [
        at(-20),
        at(-7),
        at(-3),
        at(0),
        at(5),
        at(14),
        at(40),
        at(76),
        at(80),
      ]) {
        for (let run = 0; run < 2; run++) {
          await processSubscriptions(now, { on: tx, send: mails.send })
        }
        seen.push((await findSubscription(tx, owner.id))!.reminderStage)
      }
      return seen
    })

    expect(stages).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihre Kibo-Testphase endet bald',
      'Ihre Kibo-Testphase ist abgelaufen',
      'Ihre Kibo-Bretter sind pausiert',
      'Ihre Kitas bei Kibo werden gelöscht',
    ])
    expect(mails.subjectsFor(admin.email)).toEqual([])
    // Nothing of it is left behind by the test
    expect((await subscriptionOf(owner.id))?.reminderStage).toBe(0)
  })

  test('each mail names its dates and links to the subscription page', async () => {
    const owner = await newOwner()
    const mails = outbox()
    await rolledBack(async (tx) => {
      for (const now of [at(-7), at(0), at(14), at(76)]) {
        await processSubscriptions(now, {
          on: tx,
          send: mails.send,
          only: [owner.id],
        })
      }
    })

    const [ending, expired, paused, deletion] = mails.sent
    expect(ending!.text).toStartWith('Hallo Test,\n\n')
    expect(ending!.text).toContain(
      'die Testphase Ihres Kibo-Kontos endet am 1. Juni 2026.',
    )
    expect(expired!.text).toContain(
      'die Testphase Ihres Kibo-Kontos ist am 1. Juni 2026 abgelaufen.',
    )
    // The day the grace period ends
    expect(expired!.text).toContain(
      'Ab dem 15. Juni 2026 werden die Bretter Ihrer Kitas pausiert',
    )
    expect(paused!.text).toContain(
      'werden Ihre Kitas frühestens am 30. August 2026 gelöscht',
    )
    expect(deletion!.text).toContain(
      'löschen wir am 30. August 2026 Ihre Kitas',
    )
    // Once paused, the owner hears that the data can still be exported
    const exportHint =
      'Bis zur Löschung können Sie die Daten Ihrer Kitas unter „Kita-Einstellungen“ exportieren.'
    for (const mail of [paused!, deletion!]) {
      expect(mail.text).toContain(exportHint)
    }
    for (const mail of [ending!, expired!]) {
      expect(mail.text).not.toContain(exportHint)
    }
    for (const mail of mails.sent) {
      expect(mail.to).toBe(owner.email)
      expect(mail.text).toContain(`Zum Abo:\n${ABO}\n`)
      expect(mail.html).toContain(`<a href="${ABO}"`)
      // A page, not a token: nothing about the link runs out
      expect(mail.text).not.toContain('gültig')
      expect(mail.html).not.toContain('gültig')
    }
  })
})

describe('a paid year', () => {
  // Paid up to and including 31 December 2026
  const paidUntil = berlinDayEnd('2026-12-31')!

  test('is reminded of like a trial, in its own words', async () => {
    const owner = await newOwner({ paidUntil })
    const mails = outbox()
    const only = [owner.id]
    await rolledBack(async (tx) => {
      for (const now of [
        addDays(paidUntil, -30),
        addDays(paidUntil, -7),
        paidUntil,
      ]) {
        await processSubscriptions(now, { on: tx, send: mails.send, only })
      }
    })
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihr Kibo-Abo läuft bald ab',
      'Ihr Kibo-Abo ist abgelaufen',
    ])
    expect(mails.sent[0]!.text).toContain(
      'das Abo Ihres Kibo-Kontos läuft am 31. Dezember 2026 ab.',
    )
    expect(mails.sent[1]!.text).toContain(
      'das Abo Ihres Kibo-Kontos ist am 31. Dezember 2026 abgelaufen.',
    )
    expect(mails.sent[1]!.text).toContain('Ab dem 15. Januar 2027')
  })

  // The operator has the money: what was said about the old period is over
  test('paying starts the reminders over', async () => {
    const owner = await newOwner()
    const mails = outbox()
    const only = [owner.id]
    const stages = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send: mails.send, only })
      const stage = async () =>
        (await findSubscription(tx, owner.id))!.reminderStage
      const seen: number[] = []

      await run(at(-7))
      await run(at(0))
      seen.push(await stage())
      await setPaidUntil(tx, owner.id, paidUntil, at(3))
      seen.push(await stage())
      // Active again: nothing to say for months
      await run(at(3))
      await run(addDays(paidUntil, -8))
      seen.push(await stage())
      await run(addDays(paidUntil, -7))
      await run(addDays(paidUntil, -6))
      seen.push(await stage())
      return seen
    })
    expect(stages).toEqual([2, 0, 0, 1])
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihre Kibo-Testphase endet bald',
      'Ihre Kibo-Testphase ist abgelaufen',
      'Ihr Kibo-Abo läuft bald ab',
    ])
  })
})

// The run doesn't read every account every hour: only the ones whose end is
// near or past (listReminderCandidates). Reading is all this does.
describe('the accounts a run looks at', () => {
  test('are the ones a good week before their end, and from then on', async () => {
    const owner = await newOwner()
    const read = async (now: Date) =>
      (await listReminderCandidates(testDb, now, [owner.id])).map(
        (candidate) => candidate.email,
      )
    expect(await read(at(-30))).toEqual([])
    expect(await read(at(-9))).toEqual([])
    // A day before the first reminder is due, to be on the safe side
    expect(await read(at(-8, 1))).toEqual([owner.email])
    expect(await read(at(-7))).toEqual([owner.email])
    expect(await read(at(500))).toEqual([owner.email])
  })

  test('not one that is paid for, free for good or without a Kita', async () => {
    const paid = await newOwner({ paidUntil: at(365) })
    const free = await newOwner({ complimentary: true })
    const account = await newTestUser()
    users.push(account.id)
    await testDb
      .insert(hostedSubscription)
      .values({ userId: account.id, trialEndsAt })
    const only = [paid.id, free.id, account.id]
    expect(await listReminderCandidates(testDb, at(20), only)).toEqual([])
    // The paid year ends as well
    const late = await listReminderCandidates(testDb, at(360), only)
    expect(late.map((candidate) => candidate.email)).toEqual([paid.email])
  })
})

describe('a run that comes late', () => {
  // The server was down over the end of the trial
  test('sends the reminder that is due now, not the ones it missed', async () => {
    const owner = await newOwner()
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      await processSubscriptions(at(20), {
        on: tx,
        send: mails.send,
        only: [owner.id],
      })
      return findSubscription(tx, owner.id)
    })
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihre Kibo-Bretter sind pausiert',
    ])
    expect(row).toMatchObject({ reminderStage: 3, deletionNoticeAt: null })
  })

  // HOSTED was switched on for an account whose deadline had long passed
  test('never skips the announcement of the deletion', async () => {
    const owner = await newOwner()
    const mails = outbox()
    const now = at(200)
    const row = await rolledBack(async (tx) => {
      await processSubscriptions(now, {
        on: tx,
        send: mails.send,
        only: [owner.id],
      })
      return findSubscription(tx, owner.id)
    })
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihre Kitas bei Kibo werden gelöscht',
    ])
    // Two weeks from the mail, not the deadline that is long gone
    expect(mails.sent[0]!.text).toContain('löschen wir am 1. Januar 2027')
    expect(row).toMatchObject({ reminderStage: 4, deletionNoticeAt: now })
  })
})

describe('who is never reminded', () => {
  test('an account that is free for good', async () => {
    const owner = await newOwner({ complimentary: true })
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      for (const now of [at(-7), at(0), at(14), at(76), at(200)]) {
        await processSubscriptions(now, { on: tx, send: mails.send })
      }
      return findSubscription(tx, owner.id)
    })
    expect(mails.subjectsFor(owner.email)).toEqual([])
    expect(row).toMatchObject({ reminderStage: 0, deletionNoticeAt: null })
  })

  test('an account that owns no Kita', async () => {
    // A subscription the operator set, and an admin of somebody else's Kita
    const account = await newTestUser()
    users.push(account.id)
    await testDb
      .insert(hostedSubscription)
      .values({ userId: account.id, trialEndsAt })
    const host = await newOwner({ complimentary: true })
    await addTestMember(host.organizationId, account.id, 'admin')

    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      for (const now of [at(-7), at(0), at(14), at(200)]) {
        await processSubscriptions(now, { on: tx, send: mails.send })
      }
      return findSubscription(tx, account.id)
    })
    expect(mails.subjectsFor(account.email)).toEqual([])
    expect(row?.reminderStage).toBe(0)
  })

  test('an account whose Kitas were deleted already', async () => {
    const owner = await newOwner({
      reminderStage: 0,
      kitasDeletedAt: at(100),
    })
    const mails = outbox()
    await rolledBack((tx) =>
      processSubscriptions(at(200), { on: tx, send: mails.send }),
    )
    expect(mails.subjectsFor(owner.email)).toEqual([])
  })

  test('freeing an account and taking that back starts over as well', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const row = await rolledBack(async (tx) => {
      await grantComplimentary(tx, owner.id, at(20))
      return revokeComplimentary(tx, owner.id, at(30), 30)
    })
    expect(row).toMatchObject({
      reminderStage: 0,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
      trialEndsAt: addBerlinDays(at(30), 30),
    })
  })

  test('anybody, on an instance that is not hosted', async () => {
    instanceMode.hosted = false
    const owner = await newOwner()
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      await processSubscriptions(at(200), { on: tx, send: mails.send })
      return findSubscription(tx, owner.id)
    })
    expect(mails.sent).toEqual([])
    expect(row).toMatchObject({ reminderStage: 0, deletionNoticeAt: null })
  })
})

describe('a mail that cannot be sent', () => {
  test('does not stop the run, and is not sent a second time', async () => {
    const owners = [await newOwner(), await newOwner()]
    const only = owners.map((owner) => owner.id)
    const mails = outbox()
    // Whichever account the run reaches first
    let failed: string | undefined
    const send = async (mail: Mail) => {
      if (failed === undefined) {
        failed = mail.to
        throw new Error('Postfach voll')
      }
      return mails.send(mail)
    }

    const stages = await rolledBack(async (tx) => {
      await processSubscriptions(at(0), { on: tx, send, only })
      await processSubscriptions(at(1), { on: tx, send, only })
      return Promise.all(
        owners.map(
          async (owner) =>
            (await findSubscription(tx, owner.id))!.reminderStage,
        ),
      )
    })
    // Moved on first, sent second: a mail that failed is not tried again
    expect(stages).toEqual([2, 2])
    const unlucky = owners.find((owner) => owner.email === failed)!
    const other = owners.find((owner) => owner !== unlucky)!
    expect(mails.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      [other.email, 'Ihre Kibo-Testphase ist abgelaufen'],
    ])
    expect(logged(error)).toEqual([
      `[hosted] Erinnerung 2 für Konto ${unlucky.id} nicht verschickt: Postfach voll`,
    ])
  })

  test('the log names the account by its id, never by its address', async () => {
    const owner = await newOwner()
    const mails = outbox()
    await rolledBack((tx) =>
      processSubscriptions(at(0), {
        on: tx,
        send: mails.send,
        only: [owner.id],
      }),
    )
    expect(logged(info)).toEqual([
      `[hosted] Erinnerung 2 für Konto ${owner.id} ausgelöst`,
    ])
    expect(logged(info).join()).not.toContain('@')
  })
})

// The one mail that is tried again: nothing is deleted without it, so that it
// was announced is only written once the mail is out
describe('an announcement of the deletion that cannot be sent', () => {
  // The two ways a mailer fails, and what the log says then
  const FAILURES = [
    {
      how: 'throws',
      fail: (): Promise<boolean> => Promise.reject(new Error('Postfach voll')),
      reason: 'Postfach voll',
    },
    {
      how: 'says it could not send',
      fail: (): Promise<boolean> => Promise.resolve(false),
      reason: 'Versand fehlgeschlagen',
    },
  ]

  for (const { how, fail, reason } of FAILURES) {
    test(`is sent again by the next run (the mailer ${how})`, async () => {
      const owner = await newOwner({ reminderStage: 3 })
      const only = [owner.id]
      const mails = outbox()
      let down = true
      let attempts = 0
      const send = (mail: Mail) => {
        attempts++
        return down ? fail() : mails.send(mail)
      }

      const seen = await rolledBack(async (tx) => {
        const run = (now: Date) =>
          processSubscriptions(now, { on: tx, send, only })
        const row = () => findSubscription(tx, owner.id)

        await run(at(76))
        const failed = await row()
        // A quarter of an hour on, a mail could still be on its way: not yet
        await run(at(76, 0.25))
        const waiting = { row: await row(), attempts }
        down = false
        await run(at(76, 1))
        const announced = await row()
        // And that was it
        await run(at(76, 2))
        return { failed, waiting, announced, after: await row() }
      })

      const unannounced = { reminderStage: 4, deletionNoticeAt: null }
      expect(seen.failed).toMatchObject(unannounced)
      expect(seen.waiting).toMatchObject({ row: unannounced, attempts: 1 })
      // Announced when the mail went out, not when it was first tried
      expect(seen.announced).toMatchObject({
        reminderStage: 4,
        deletionNoticeAt: at(76, 1),
      })
      expect(seen.after).toEqual(seen.announced)
      expect(attempts).toBe(2)
      expect(mails.subjectsFor(owner.email)).toEqual([
        'Ihre Kitas bei Kibo werden gelöscht',
      ])
      expect(logged(error)).toEqual([
        `[hosted] Erinnerung 4 für Konto ${owner.id} nicht verschickt: ${reason}`,
      ])
      expect(logged(info)).toEqual([
        `[hosted] Erinnerung 4 für Konto ${owner.id} ausgelöst`,
      ])
    })
  }

  test('is tried every hour for as long as it takes, and names the day that holds then', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const only = [owner.id]
    const mails = outbox()
    let down = true
    const send = async (mail: Mail) => {
      if (down) return false
      await mails.send(mail)
      return true
    }

    const row = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send, only })
      for (const hour of [0, 1, 2, 3]) await run(at(76, hour))
      // The mail server is back five days after the deadline
      down = false
      await run(at(95))
      return findSubscription(tx, owner.id)
    })

    expect(logged(error)).toHaveLength(4)
    expect(row).toMatchObject({ reminderStage: 4, deletionNoticeAt: at(95) })
    expect(mails.sent).toHaveLength(1)
    // Two weeks from the mail that went out: 4 September and 14 days
    expect(mails.sent[0]!.text).toContain('löschen wir am 18. September 2026')
  })

  // The process died between the claim and the mail, or between the mail and
  // the note of it: the row is all the next run has to go by
  test('is taken up from a row that was left at stage 4 without it', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      await processSubscriptions(at(77), {
        on: tx,
        send: mails.send,
        only: [owner.id],
      })
      return findSubscription(tx, owner.id)
    })
    expect(mails.subjectsFor(owner.email)).toEqual([
      'Ihre Kitas bei Kibo werden gelöscht',
    ])
    expect(row).toMatchObject({ reminderStage: 4, deletionNoticeAt: at(77) })
  })
})

// Two app processes whose hourly runs fall on the same moment. No
// transaction around it, so each works on a connection of its own; `only`
// keeps the two runs to the accounts of this test.
describe('two runs at the same time', () => {
  test('send one mail', async () => {
    const owners = [await newOwner(), await newOwner(), await newOwner()]
    const only = owners.map((owner) => owner.id)
    const mails = outbox()

    for (const now of [at(-7), at(0), at(14), at(76)]) {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          processSubscriptions(now, { on: testDb, send: mails.send, only }),
        ),
      )
    }

    for (const owner of owners) {
      expect(mails.subjectsFor(owner.email)).toEqual([
        'Ihre Kibo-Testphase endet bald',
        'Ihre Kibo-Testphase ist abgelaufen',
        'Ihre Kibo-Bretter sind pausiert',
        'Ihre Kitas bei Kibo werden gelöscht',
      ])
      expect(await subscriptionOf(owner.id)).toMatchObject({
        reminderStage: 4,
        deletionNoticeAt: at(76),
      })
    }
    expect(mails.sent).toHaveLength(12)
  })

  // The same for the announcement that is tried again
  test('send one mail for an announcement that did not go out before', async () => {
    const owners = [
      await newOwner({ reminderStage: 4, updatedAt: at(76) }),
      await newOwner({ reminderStage: 4, updatedAt: at(76) }),
    ]
    const only = owners.map((owner) => owner.id)
    const mails = outbox()

    await Promise.all(
      Array.from({ length: 4 }, () =>
        processSubscriptions(at(77), { on: testDb, send: mails.send, only }),
      ),
    )

    for (const owner of owners) {
      expect(mails.subjectsFor(owner.email)).toEqual([
        'Ihre Kitas bei Kibo werden gelöscht',
      ])
      expect(await subscriptionOf(owner.id)).toMatchObject({
        reminderStage: 4,
        deletionNoticeAt: at(77),
      })
    }
  })

  test('`only` keeps a run to the accounts it names', async () => {
    const reached = await newOwner()
    const left = await newOwner()
    const mails = outbox()
    await processSubscriptions(at(0), {
      on: testDb,
      send: mails.send,
      only: [reached.id],
    })
    expect(mails.sent.map((mail) => mail.to)).toEqual([reached.email])
    expect((await subscriptionOf(reached.id))?.reminderStage).toBe(2)
    expect((await subscriptionOf(left.id))?.reminderStage).toBe(0)
  })
})

describe('advanceReminderStage', () => {
  const row = (on: Executor, userId: string) => findSubscription(on, userId)

  test('moves a row on once, and never back', async () => {
    const owner = await newOwner()
    const result = await rolledBack(async (tx) => {
      const before = (await row(tx, owner.id))!
      return [
        await advanceReminderStage(tx, before, 2, at(0)),
        await advanceReminderStage(tx, before, 2, at(0)),
        await advanceReminderStage(tx, before, 1, at(0)),
        await advanceReminderStage(tx, before, 3, at(14)),
        (await row(tx, owner.id))!.reminderStage,
      ]
    })
    expect(result).toEqual([true, false, false, true, 3])
  })

  // Read as expired, and paid for before the mail was decided on: the mail
  // would be wrong, and the new period would start with a reminder spent
  test('leaves a row alone that was paid for since it was read', async () => {
    const owner = await newOwner()
    const result = await rolledBack(async (tx) => {
      const stale = (await row(tx, owner.id))!
      await setPaidUntil(tx, owner.id, at(365), at(0))
      const advanced = await advanceReminderStage(tx, stale, 2, at(0))
      return { advanced, stage: (await row(tx, owner.id))!.reminderStage }
    })
    expect(result).toEqual({ advanced: false, stage: 0 })
  })

  test('nor one that was freed or whose Kitas were deleted', async () => {
    const owner = await newOwner()
    const result = await rolledBack(async (tx) => {
      const stale = (await row(tx, owner.id))!
      await grantComplimentary(tx, owner.id, at(0))
      const freed = await advanceReminderStage(tx, stale, 2, at(0))
      await tx
        .update(hostedSubscription)
        .set({ complimentary: false, kitasDeletedAt: at(0) })
        .where(eq(hostedSubscription.userId, owner.id))
      return [freed, await advanceReminderStage(tx, stale, 2, at(0))]
    })
    expect(result).toEqual([false, false])
  })

  // A date somebody set by hand has microseconds JavaScript never read
  test('knows a row by its dates down to the millisecond, not beyond', async () => {
    const owner = await newOwner()
    const advanced = await rolledBack(async (tx) => {
      await tx
        .update(hostedSubscription)
        .set({
          trialEndsAt: sql`timestamptz '2026-06-01 10:00:00.123456+00'`,
          paidUntil: sql`timestamptz '2026-06-02 10:00:00.999999+00'`,
        })
        .where(eq(hostedSubscription.userId, owner.id))
      const read = (await row(tx, owner.id))!
      return advanceReminderStage(tx, read, 2, at(5))
    })
    expect(advanced).toBe(true)
  })

  // That is confirmDeletionNotice's to say, once the mail is out
  test('moving on to stage 4 does not say that the deletion was announced', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const before = (await row(tx, owner.id))!
      const advanced = await advanceReminderStage(tx, before, 4, at(76))
      return { advanced, row: await row(tx, owner.id) }
    })
    expect(result.advanced).toBe(true)
    expect(result.row).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: null,
      updatedAt: at(76),
    })
  })

  test('takes an announcement up again that was never confirmed: not at once, and once', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const result = await rolledBack(async (tx) => {
      const read = (await row(tx, owner.id))!
      return [
        // The first attempt may still be under way
        await advanceReminderStage(tx, read, 4, at(76)),
        await advanceReminderStage(tx, read, 4, at(76, 0.4)),
        await advanceReminderStage(tx, read, 4, at(76, 0.5)),
        // The row was touched by the call that won
        await advanceReminderStage(tx, read, 4, at(76, 0.5)),
        await advanceReminderStage(tx, read, 4, at(78)),
        // No other reminder is ever sent twice
        await advanceReminderStage(tx, read, 3, at(78)),
      ]
    })
    expect(result).toEqual([false, false, true, false, false, false])
  })

  test('leaves an announcement alone that went out', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
      updatedAt: at(76),
    })
    const advanced = await rolledBack(async (tx) => {
      const read = (await row(tx, owner.id))!
      return advanceReminderStage(tx, read, 4, at(80))
    })
    expect(advanced).toBe(false)
  })

  test('nor one of a row that was paid for since it was read', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const result = await rolledBack(async (tx) => {
      const stale = (await row(tx, owner.id))!
      await setPaidUntil(tx, owner.id, at(365), at(77))
      const advanced = await advanceReminderStage(tx, stale, 4, at(78))
      return { advanced, stage: (await row(tx, owner.id))!.reminderStage }
    })
    expect(result).toEqual({ advanced: false, stage: 0 })
  })
})

describe('confirmDeletionNotice', () => {
  const row = (on: Executor, userId: string) => findSubscription(on, userId)

  test('writes when the announcement went out, once', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const result = await rolledBack(async (tx) => {
      const read = (await row(tx, owner.id))!
      // Taken up again at that moment: the claim the mail belongs to
      await advanceReminderStage(tx, read, 4, at(77))
      return {
        confirmed: [
          await confirmDeletionNotice(tx, read, at(77)),
          await confirmDeletionNotice(tx, read, at(77)),
          await confirmDeletionNotice(tx, read, at(78)),
        ],
        row: await row(tx, owner.id),
      }
    })
    expect(result.confirmed).toEqual([true, false, false])
    expect(result.row).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: at(77),
    })
  })

  // Only the claim the mail was sent for: another one since — or none at
  // that moment — is not that mail's to confirm
  test('nor for a claim other than its own', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const read = (await row(tx, owner.id))!
      await advanceReminderStage(tx, read, 4, at(77))
      return [
        await confirmDeletionNotice(tx, read, at(76)),
        await confirmDeletionNotice(tx, read, at(77, 1)),
      ]
    })
    expect(result).toEqual([false, false])
  })

  test('not for a row that never got to stage 4', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const read = (await row(tx, owner.id))!
      const confirmed = await confirmDeletionNotice(tx, read, at(76))
      return { confirmed, row: await row(tx, owner.id) }
    })
    expect(result.confirmed).toBe(false)
    expect(result.row?.deletionNoticeAt).toBeNull()
  })

  // Paid while the mail was on its way: the new period starts without a
  // notice it never earned
  test('nor for one that was paid for since it was read', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const result = await rolledBack(async (tx) => {
      const stale = (await row(tx, owner.id))!
      await setPaidUntil(tx, owner.id, at(365), at(77))
      const confirmed = await confirmDeletionNotice(tx, stale, at(77))
      return { confirmed, row: await row(tx, owner.id) }
    })
    expect(result.confirmed).toBe(false)
    expect(result.row).toMatchObject({
      reminderStage: 0,
      deletionNoticeAt: null,
    })
  })
})
