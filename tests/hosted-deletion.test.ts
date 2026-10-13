import { randomUUID } from 'node:crypto'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import {
  board,
  hostedSubscription,
  invitation,
  kitaLink,
  member,
  note,
  organization,
  pushSubscription,
  reportCase,
  user,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { addDays } from '@/lib/board/time'
import { statusSummary } from '@/lib/hosted/overview'
import {
  deleteOwnerlessKitas,
  processSubscriptions,
} from '@/lib/hosted/reminders'
import {
  advanceReminderStage,
  confirmDeletionNotice,
  deleteKitasNow,
  deleteKitasOf,
  deletionClaimStands,
  findSubscription,
  holdDeletion,
  listReminderCandidates,
  releaseDeletionHold,
  setPaidUntil,
} from '@/lib/hosted/subscriptions'
import { instanceMode } from '@/lib/instance'
import type { Mail } from '@/lib/mail/mailer'

import {
  addTestMember,
  insertTestNote,
  newOwnedKita,
  newTestBoard,
  newTestKita,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  rolledBack,
  subscriptionOf,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// What the hosted instance deletes on its hourly run
// (src/lib/hosted/reminders.ts): the Kitas of an account whose subscription
// ran out 90 days ago — but only two weeks after the mail that announced it —
// and the Kitas nobody owns. Against the local PostgreSQL, and always in a
// transaction that is rolled back: nothing is ever deleted for real, neither
// of this test nor of anybody else.
const kitas: string[] = []
const users: string[] = []

// The trial ended at noon in Berlin on 1 June; 90 days later is 30 August
const trialEndsAt = new Date('2026-06-01T10:00:00.000Z')
const at = (days: number, ms = 0) =>
  new Date(addDays(trialEndsAt, days).getTime() + ms)

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

// A Kita with everything that hangs on one: a board with a note and a push
// subscription, an invited admin and an invitation that is still open
async function furnish(organizationId: string, ownerId: string) {
  const { id: boardId } = await newTestBoard(organizationId)
  const noteId = await insertTestNote(boardId)
  await testDb.insert(pushSubscription).values({
    boardId,
    endpoint: `https://fcm.googleapis.com/fcm/send/deletion-${randomUUID()}`,
    p256dh: 'p256dh',
    auth: 'auth',
  })
  const admin = await newTestUser()
  users.push(admin.id)
  await addTestMember(organizationId, admin.id, 'admin')
  const invitationId = `test-${randomUUID()}`
  await testDb.insert(invitation).values({
    id: invitationId,
    organizationId,
    email: `eingeladen-${randomUUID()}@kita.example`,
    role: 'admin',
    expiresAt: addDays(new Date(), 7),
    inviterId: ownerId,
  })
  return { boardId, noteId, admin, invitationId }
}

// How much of a Kita is there, as the transaction sees it
async function remains(on: Executor, organizationId: string, boardId: string) {
  const count = async (rows: Promise<unknown[]>) => (await rows).length
  return {
    kita: await count(
      on.select().from(organization).where(eq(organization.id, organizationId)),
    ),
    boards: await count(
      on.select().from(board).where(eq(board.organizationId, organizationId)),
    ),
    notes: await count(on.select().from(note).where(eq(note.boardId, boardId))),
    pushSubscriptions: await count(
      on
        .select()
        .from(pushSubscription)
        .where(eq(pushSubscription.boardId, boardId)),
    ),
    members: await count(
      on.select().from(member).where(eq(member.organizationId, organizationId)),
    ),
    invitations: await count(
      on
        .select()
        .from(invitation)
        .where(eq(invitation.organizationId, organizationId)),
    ),
  }
}

const THERE = {
  kita: 1,
  boards: 1,
  notes: 1,
  pushSubscriptions: 1,
  members: 2,
  invitations: 1,
}
const GONE = {
  kita: 0,
  boards: 0,
  notes: 0,
  pushSubscriptions: 0,
  members: 0,
  invitations: 0,
}

function outbox() {
  const sent: Mail[] = []
  return {
    sent,
    send: async (mail: Mail) => {
      sent.push(mail)
      return true
    },
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

describe('the Kitas of an account whose subscription ran out', () => {
  test('go 90 days after the end, two weeks after the announcement', async () => {
    const owner = await newOwner()
    const kita = await furnish(owner.organizationId, owner.id)
    const mails = outbox()
    const only = [owner.id]

    const seen = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send: mails.send, only })
      const state = () => remains(tx, owner.organizationId, kita.boardId)

      // Announced two weeks before the deadline …
      await run(at(76))
      const announced = await findSubscription(tx, owner.id)
      // … and still there a moment before it
      await run(at(90, -1))
      const before = await state()
      await run(at(90))
      return {
        announced,
        before,
        after: await state(),
        row: await findSubscription(tx, owner.id),
        account: await tx.select().from(user).where(eq(user.id, owner.id)),
        admin: await tx.select().from(user).where(eq(user.id, kita.admin.id)),
      }
    })

    expect(seen.announced).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: at(76),
      kitasDeletedAt: null,
    })
    expect(seen.before).toEqual(THERE)
    expect(seen.after).toEqual(GONE)
    // The account and its subscription stay, and so does the invited admin
    expect(seen.account).toHaveLength(1)
    expect(seen.admin).toHaveLength(1)
    expect(seen.row).toMatchObject({
      kitasDeletedAt: at(90),
      deletionNoticeAt: at(76),
      reminderStage: 4,
      trialEndsAt,
    })
    expect(mails.sent.map((mail) => mail.subject)).toEqual([
      'Ihre Kitas bei Kibo werden gelöscht',
    ])
    // Rolled back: the Kita of the test is as it was
    expect(await remains(testDb, owner.organizationId, kita.boardId)).toEqual(
      THERE,
    )
  })

  // HOSTED was switched on late, or set-paid named a day long ago
  test('an account whose deadline passed unannounced is told first and keeps its two weeks', async () => {
    const owner = await newOwner()
    const kita = await furnish(owner.organizationId, owner.id)
    const mails = outbox()
    const only = [owner.id]
    const late = at(300)

    const seen = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send: mails.send, only })
      const state = () => remains(tx, owner.organizationId, kita.boardId)

      await run(late)
      const first = await state()
      await run(addDays(late, 1))
      await run(new Date(addDays(late, 14).getTime() - 1))
      const waiting = await state()
      await run(addDays(late, 14))
      return { first, waiting, after: await state() }
    })

    expect(seen.first).toEqual(THERE)
    expect(seen.waiting).toEqual(THERE)
    expect(seen.after).toEqual(GONE)
    // One mail: the announcement, which names the day two weeks on
    expect(mails.sent).toHaveLength(1)
    expect(mails.sent[0]!.text).toContain('löschen wir am 11. April 2027')
  })

  // The mail server was down when the announcement was due: that it was
  // tried counts for nothing
  test('an announcement that did not go out deletes nothing: the two weeks count from the one that did', async () => {
    const owner = await newOwner()
    const kita = await furnish(owner.organizationId, owner.id)
    const mails = outbox()
    const only = [owner.id]
    let down = true
    const send = async (mail: Mail) => {
      if (down) return false
      await mails.send(mail)
      return true
    }

    const seen = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send, only })
      const state = () => remains(tx, owner.organizationId, kita.boardId)

      await run(at(76))
      const failed = await findSubscription(tx, owner.id)
      // Every run up to the deadline and past it fails the same way
      for (const day of [77, 83, 90, 91, 100]) await run(at(day))
      const unannounced = await state()
      down = false
      await run(at(101))
      const announced = await findSubscription(tx, owner.id)
      await run(at(115, -1))
      const waiting = await state()
      await run(at(115))
      return { failed, unannounced, announced, waiting, after: await state() }
    })

    expect(seen.failed).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
    })
    expect(seen.unannounced).toEqual(THERE)
    expect(seen.announced).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: at(101),
      kitasDeletedAt: null,
    })
    expect(seen.waiting).toEqual(THERE)
    expect(seen.after).toEqual(GONE)
    // The one mail that went out names the day the Kitas went
    expect(mails.sent).toHaveLength(1)
    expect(mails.sent[0]!.text).toContain('löschen wir am 24. September 2026')
  })

  // What a process leaves behind that died before the mail was out, or a
  // mail server that never takes it
  test('a row at stage 4 without an announcement is never deleted, however long ago the deadline passed', async () => {
    const owner = await newOwner({ reminderStage: 4, updatedAt: at(76) })
    const kita = await furnish(owner.organizationId, owner.id)
    const only = [owner.id]

    const seen = await rolledBack(async (tx) => {
      for (const now of [at(90), at(91), at(500), at(5000)]) {
        await processSubscriptions(now, {
          on: tx,
          send: () => Promise.reject(new Error('Postfach voll')),
          only,
        })
      }
      return {
        state: await remains(tx, owner.organizationId, kita.boardId),
        row: await findSubscription(tx, owner.id),
      }
    })

    expect(seen.state).toEqual(THERE)
    expect(seen.row).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
    })
    expect(logged(error)).toEqual(
      Array.from(
        { length: 4 },
        () =>
          `[hosted] Erinnerung 4 für Konto ${owner.id} nicht verschickt: Postfach voll`,
      ),
    )
  })

  test('every Kita the account owns goes, and nobody else’s', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const second = await newTestKita()
    kitas.push(second)
    await addTestMember(second, owner.id)
    // A Kita the account only helps to manage, owned by somebody who pays
    const host = await newOwner({ paidUntil: at(400) })
    await addTestMember(host.organizationId, owner.id, 'admin')

    const left = await rolledBack(async (tx) => {
      await processSubscriptions(at(91), {
        on: tx,
        send: outbox().send,
        only: [owner.id, host.id],
      })
      const rows = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(
          inArray(organization.id, [
            owner.organizationId,
            second,
            host.organizationId,
          ]),
        )
      return rows.map((row) => row.id)
    })
    expect(left).toEqual([host.organizationId])
    expect(logged(info)).toEqual([
      `[hosted] Kitas des Kontos ${owner.id} gelöscht (2)`,
    ])
    expect(logged(info).join()).not.toContain('@')
    expect(logged(error)).toEqual([])
  })

  test('afterwards the account hears nothing more', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      for (const now of [at(90), at(91), at(120), at(500)]) {
        await processSubscriptions(now, { on: tx, send: mails.send })
      }
      return findSubscription(tx, owner.id)
    })
    expect(mails.sent.filter((mail) => mail.to === owner.email)).toEqual([])
    expect(row).toMatchObject({ kitasDeletedAt: at(90), reminderStage: 4 })
    expect(logged(info).filter((line) => line.includes(owner.id))).toHaveLength(
      1,
    )
  })

  test('paying in time keeps the Kitas', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const kita = await furnish(owner.organizationId, owner.id)
    const seen = await rolledBack(async (tx) => {
      await setPaidUntil(tx, owner.id, at(365), at(89))
      await processSubscriptions(at(90), {
        on: tx,
        send: outbox().send,
        only: [owner.id],
      })
      return {
        state: await remains(tx, owner.organizationId, kita.boardId),
        row: await findSubscription(tx, owner.id),
      }
    })
    expect(seen.state).toEqual(THERE)
    expect(seen.row).toMatchObject({
      reminderStage: 0,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
    })
  })

  test('an account that is free for good keeps its Kitas whatever its dates say', async () => {
    const owner = await newOwner({
      complimentary: true,
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const left = await rolledBack(async (tx) => {
      await processSubscriptions(at(500), { on: tx, send: outbox().send })
      return tx
        .select()
        .from(organization)
        .where(eq(organization.id, owner.organizationId))
    })
    expect(left).toHaveLength(1)
  })

  test('nothing is deleted on an instance that is not hosted', async () => {
    instanceMode.hosted = false
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const seen = await rolledBack(async (tx) => {
      await processSubscriptions(at(500), { on: tx, send: outbox().send })
      return {
        kitas: await tx
          .select()
          .from(organization)
          .where(eq(organization.id, owner.organizationId)),
        row: await findSubscription(tx, owner.id),
      }
    })
    expect(seen.kitas).toHaveLength(1)
    expect(seen.row?.kitasDeletedAt).toBeNull()
  })
})

describe('deleteKitasOf', () => {
  // Two processes whose runs fall on the same moment
  test('deletes once: the second call finds the row marked', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const result = await rolledBack(async (tx) => {
      const row = (await findSubscription(tx, owner.id))!
      return [
        await deleteKitasOf(tx, row, at(90)),
        await deleteKitasOf(tx, row, at(90)),
      ]
    })
    expect(result).toEqual([1, undefined])
  })

  test('leaves the Kitas of an account that paid since the row was read', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const result = await rolledBack(async (tx) => {
      const stale = (await findSubscription(tx, owner.id))!
      await setPaidUntil(tx, owner.id, at(365), at(90))
      const deleted = await deleteKitasOf(tx, stale, at(90))
      const left = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, owner.organizationId))
      return { deleted, left: left.length }
    })
    expect(result).toEqual({ deleted: undefined, left: 1 })
  })

  // The dates are as they were, but the period started over: set-paid named
  // the day that was paid up to already, which resets the reminders and
  // nothing else. The announcement the run counted from is history.
  test('leaves the Kitas of an account whose announcement was taken back since the row was read', async () => {
    const paidUntil = at(-10)
    const owner = await newOwner({
      paidUntil,
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const result = await rolledBack(async (tx) => {
      const stale = (await findSubscription(tx, owner.id))!
      await setPaidUntil(tx, owner.id, paidUntil, at(90))
      const reset = (await findSubscription(tx, owner.id))!
      const deleted = await deleteKitasOf(tx, stale, at(90))
      const left = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, owner.organizationId))
      return { stale, reset, deleted, left: left.length }
    })
    // Only the reminders changed …
    expect(result.reset).toMatchObject({
      trialEndsAt: result.stale.trialEndsAt,
      paidUntil: result.stale.paidUntil,
      complimentary: false,
      reminderStage: 0,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
    })
    // … and that is enough
    expect(result.deleted).toBeUndefined()
    expect(result.left).toBe(1)
  })

  test('nor those of one that was announced anew, at another moment', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const result = await rolledBack(async (tx) => {
      const stale = (await findSubscription(tx, owner.id))!
      await tx
        .update(hostedSubscription)
        .set({ deletionNoticeAt: at(89) })
        .where(eq(hostedSubscription.userId, owner.id))
      const deleted = await deleteKitasOf(tx, stale, at(90))
      const row = await findSubscription(tx, owner.id)
      return { deleted, kitasDeletedAt: row?.kitasDeletedAt }
    })
    expect(result).toEqual({ deleted: undefined, kitasDeletedAt: null })
  })

  test('deletes nothing for a row without an announcement, at whatever stage', async () => {
    const owners = [
      await newOwner({ reminderStage: 4 }),
      await newOwner({ reminderStage: 3 }),
    ]
    const result = await rolledBack(async (tx) => {
      const deleted = []
      for (const owner of owners) {
        const row = (await findSubscription(tx, owner.id))!
        deleted.push(await deleteKitasOf(tx, row, at(500)))
      }
      const left = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(
          inArray(
            organization.id,
            owners.map((owner) => owner.organizationId),
          ),
        )
      const rows = await Promise.all(
        owners.map((owner) => findSubscription(tx, owner.id)),
      )
      return {
        deleted,
        left: left.length,
        marked: rows.map((row) => row?.kitasDeletedAt),
      }
    })
    expect(result).toEqual({
      deleted: [undefined, undefined],
      left: 2,
      marked: [null, null],
    })
  })

  // Announced, but the row never got to stage 4: not a row this code writes
  test('nor for a row whose stage does not match its announcement', async () => {
    const owner = await newOwner({
      reminderStage: 3,
      deletionNoticeAt: at(76),
    })
    const deleted = await rolledBack(async (tx) => {
      const row = (await findSubscription(tx, owner.id))!
      return deleteKitasOf(tx, row, at(90))
    })
    expect(deleted).toBeUndefined()
  })
})

// A request to switch providers or to have the data erased: the operator
// holds the deletion until the retrieval period is over (hold-deletion)
describe('a held deletion', () => {
  const DELETION_NOTICE = 'Ihre Kitas bei Kibo werden gelöscht'

  test('keeps the Kitas of an account that is due, however old its announcement', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
      deletionHeldUntil: at(120),
    })
    const kita = await furnish(owner.organizationId, owner.id)
    const mails = outbox()
    const seen = await rolledBack(async (tx) => {
      for (const day of [90, 91, 100, 119]) {
        await processSubscriptions(at(day), {
          on: tx,
          send: mails.send,
          only: [owner.id],
        })
      }
      return {
        state: await remains(tx, owner.organizationId, kita.boardId),
        // Directly, as a run that read the row before would
        deleted: await deleteKitasOf(
          tx,
          (await findSubscription(tx, owner.id))!,
          at(119),
        ),
      }
    })
    expect(seen).toEqual({ state: THERE, deleted: undefined })
    expect(mails.sent).toEqual([])
    expect(logged(info)).toContain(
      `[hosted] Löschung der Kitas des Kontos ${owner.id} angehalten bis 29. September 2026`,
    )
  })

  test('takes the announcement back; after the hold a new one goes out and the deletion follows two weeks later', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
    })
    const kita = await furnish(owner.organizationId, owner.id)
    const mails = outbox()
    const only = [owner.id]

    const seen = await rolledBack(async (tx) => {
      const run = (now: Date) =>
        processSubscriptions(now, { on: tx, send: mails.send, only })
      const state = () => remains(tx, owner.organizationId, kita.boardId)

      const held = await holdDeletion(tx, owner.id, at(120), at(80))
      for (const day of [85, 90, 91, 119]) await run(at(day))
      const whileHeld = { state: await state(), mails: mails.sent.length }
      // The hold is over: announced anew …
      await run(at(120))
      const announced = await findSubscription(tx, owner.id)
      // … and deleted two weeks after that, not a moment before
      await run(at(134, -1))
      const waiting = await state()
      await run(at(134))
      return { held, whileHeld, announced, waiting, after: await state() }
    })

    expect(seen.held).toMatchObject({
      outcome: 'held',
      subscription: {
        reminderStage: 3,
        deletionNoticeAt: null,
        deletionHeldUntil: at(120),
        updatedAt: at(80),
      },
    })
    expect(seen.whileHeld).toEqual({ state: THERE, mails: 0 })
    expect(seen.announced).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: at(120),
    })
    expect(seen.waiting).toEqual(THERE)
    expect(seen.after).toEqual(GONE)
    expect(mails.sent.map((mail) => mail.subject)).toEqual([DELETION_NOTICE])
    expect(mails.sent[0]!.text).toContain('löschen wir am 13. Oktober 2026')
  })

  // A run that read the row before the operator held the deletion
  test('stops a run that read the row before', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const stale = (await findSubscription(tx, owner.id))!
      await holdDeletion(tx, owner.id, at(120), at(80))
      return {
        advanced: await advanceReminderStage(tx, stale, 4, at(80)),
        confirmed: await confirmDeletionNotice(
          tx,
          { ...stale, reminderStage: 4 },
          at(80),
        ),
      }
    })
    expect(result).toEqual({ advanced: false, confirmed: false })
  })

  test('lets the reminders before the announcement go out', async () => {
    const owner = await newOwner({ deletionHeldUntil: at(200) })
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      for (const day of [-7, 0, 15, 77, 91]) {
        await processSubscriptions(at(day), {
          on: tx,
          send: mails.send,
          only: [owner.id],
        })
      }
      return findSubscription(tx, owner.id)
    })
    expect(mails.sent).toHaveLength(3)
    expect(mails.sent.map((mail) => mail.subject)).not.toContain(
      DELETION_NOTICE,
    )
    expect(row).toMatchObject({ reminderStage: 3, deletionNoticeAt: null })
  })

  test('released, the run goes on as usual', async () => {
    const owner = await newOwner({
      reminderStage: 3,
      deletionHeldUntil: at(200),
    })
    const mails = outbox()
    const row = await rolledBack(async (tx) => {
      await releaseDeletionHold(tx, owner.id, at(80))
      await processSubscriptions(at(80), {
        on: tx,
        send: mails.send,
        only: [owner.id],
      })
      return findSubscription(tx, owner.id)
    })
    expect(mails.sent.map((mail) => mail.subject)).toEqual([DELETION_NOTICE])
    expect(row).toMatchObject({
      deletionHeldUntil: null,
      reminderStage: 4,
      deletionNoticeAt: at(80),
    })
  })

  test('there is nothing to hold for an account without a row', async () => {
    const { owner, organizationId } = await newOwnedKita()
    kitas.push(organizationId)
    users.push(owner.id)
    const result = await rolledBack(async (tx) => [
      await holdDeletion(tx, owner.id, at(120), at(80)),
      await releaseDeletionHold(tx, owner.id, at(80)),
    ])
    expect(result).toEqual([{ outcome: 'noSubscription' }, undefined])
  })

  // Nothing left to keep for the retrieval period: the row stays as it is
  test('refuses an account whose Kitas are deleted already', async () => {
    const owner = await newOwner({
      reminderStage: 4,
      deletionNoticeAt: at(76),
      kitasDeletedAt: at(90),
    })
    const seen = await rolledBack(async (tx) => ({
      hold: await holdDeletion(tx, owner.id, at(120), at(100)),
      row: await findSubscription(tx, owner.id),
    }))
    expect(seen.hold).toEqual({ outcome: 'kitasDeleted', at: at(90) })
    expect(seen.row).toMatchObject({
      reminderStage: 4,
      deletionNoticeAt: at(76),
      deletionHeldUntil: null,
    })
  })

  // The announcement was claimed, and the operator held the deletion before
  // the mail was noted: it is not the announcement
  test('a hold after the claim rejects its confirmation', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const read = (await findSubscription(tx, owner.id))!
      const claimed = await advanceReminderStage(tx, read, 4, at(80))
      const before = await deletionClaimStands(tx, read, at(80))
      await holdDeletion(tx, owner.id, at(120), at(80, 1000))
      return {
        claimed,
        before,
        after: await deletionClaimStands(tx, read, at(80)),
        confirmed: await confirmDeletionNotice(tx, read, at(80)),
        row: await findSubscription(tx, owner.id),
      }
    })
    expect(result).toMatchObject({
      claimed: true,
      before: true,
      after: false,
      confirmed: false,
      row: { reminderStage: 3, deletionNoticeAt: null },
    })
  })

  // Held and released again while the first mail was on its way, and a new
  // run claimed the announcement: only the new claim may note its mail
  test('a hold and its release reject the confirmation of the claim before', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const result = await rolledBack(async (tx) => {
      const first = (await findSubscription(tx, owner.id))!
      await advanceReminderStage(tx, first, 4, at(80))
      await holdDeletion(tx, owner.id, at(120), at(80, 1000))
      await releaseDeletionHold(tx, owner.id, at(80, 2000))
      const second = (await findSubscription(tx, owner.id))!
      const reclaimed = await advanceReminderStage(tx, second, 4, at(80, 3000))
      return {
        reclaimed,
        old: await deletionClaimStands(tx, first, at(80)),
        oldConfirmed: await confirmDeletionNotice(tx, first, at(80)),
        newConfirmed: await confirmDeletionNotice(tx, second, at(80, 3000)),
        row: await findSubscription(tx, owner.id),
      }
    })
    expect(result).toMatchObject({
      reclaimed: true,
      old: false,
      oldConfirmed: false,
      newConfirmed: true,
      row: { reminderStage: 4, deletionNoticeAt: at(80, 3000) },
    })
  })

  // The whole run: the hold lands while the announcement is being sent
  test('a run whose announcement was overtaken by a hold notes nothing', async () => {
    const owner = await newOwner({ reminderStage: 3 })
    const row = await rolledBack(async (tx) => {
      await processSubscriptions(at(80), {
        on: tx,
        send: async () => {
          await holdDeletion(tx, owner.id, at(120), at(80, 1000))
          return true
        },
        only: [owner.id],
      })
      return findSubscription(tx, owner.id)
    })
    expect(row).toMatchObject({
      reminderStage: 3,
      deletionNoticeAt: null,
      deletionHeldUntil: at(120),
    })
  })
})

// The operator's deletion after the retrieval period (delete-kitas)
describe('deleteKitasNow', () => {
  test('deletes every Kita the account owns with everything in it, and nothing else', async () => {
    const owner = await newOwner({
      reminderStage: 3,
      deletionHeldUntil: at(120),
    })
    const kita = await furnish(owner.organizationId, owner.id)
    const second = await newTestKita()
    kitas.push(second)
    await addTestMember(second, owner.id)
    // A Kita the account only helps to manage
    const host = await newOwner({ paidUntil: at(400) })
    await addTestMember(host.organizationId, owner.id, 'admin')

    const seen = await rolledBack(async (tx) => {
      await tx.insert(reportCase).values({
        boardId: kita.boardId,
        organizationId: owner.organizationId,
        noteId: kita.noteId,
        noteCategoryId: 'hinweis',
        noteTitle: 'Test',
        noteBody: 'Test',
        noteAuthor: 'Test',
        noteCreatedAt: at(100),
        noteExpiresAt: at(110),
        firstReportedAt: at(100),
        lastReportedAt: at(100),
      })
      const deleted = await deleteKitasNow(tx, owner.id, at(100))
      const ids = [owner.organizationId, second, host.organizationId]
      const left = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(inArray(organization.id, ids))
      return {
        deleted: deleted.map((kita) => kita.id).toSorted(),
        left: left.map((row) => row.id),
        state: await remains(tx, owner.organizationId, kita.boardId),
        cases: await tx
          .select()
          .from(reportCase)
          .where(eq(reportCase.organizationId, owner.organizationId)),
        links: await tx
          .select()
          .from(kitaLink)
          .where(eq(kitaLink.organizationId, owner.organizationId)),
        account: await tx.select().from(user).where(eq(user.id, owner.id)),
        row: await findSubscription(tx, owner.id),
        again: await deleteKitasNow(tx, owner.id, at(101)),
        rowAfterNothing: await findSubscription(tx, owner.id),
      }
    })
    expect(seen.deleted).toEqual([owner.organizationId, second].toSorted())
    expect(seen.left).toEqual([host.organizationId])
    expect(seen.state).toEqual(GONE)
    expect(seen.cases).toEqual([])
    expect(seen.links).toEqual([])
    expect(seen.account).toHaveLength(1)
    expect(seen.row).toMatchObject({
      kitasDeletedAt: at(100),
      deletionHeldUntil: null,
      updatedAt: at(100),
    })
    // Nothing left to delete: nothing is written
    expect(seen.again).toEqual([])
    expect(seen.rowAfterNothing?.kitasDeletedAt).toEqual(at(100))
  })

  // An erasure request during a paid year: the Kitas go, the year goes on
  test('leaves a running subscription unmarked, so later Kitas are reminded and deleted as usual', async () => {
    const owner = await newOwner({
      paidUntil: at(365),
      reminderStage: 1,
      deletionHeldUntil: at(200),
    })
    const seen = await rolledBack(async (tx) => {
      const deleted = await deleteKitasNow(tx, owner.id, at(100))
      const row = (await findSubscription(tx, owner.id))!
      // The account creates a Kita again
      const again = `test-${randomUUID()}`
      await tx.insert(organization).values({
        id: again,
        name: 'Test-Kita',
        slug: again,
        createdAt: at(101),
      })
      await tx.insert(member).values({
        id: `test-${randomUUID()}`,
        organizationId: again,
        userId: owner.id,
        role: 'owner',
        createdAt: at(101),
      })
      const candidates = await listReminderCandidates(tx, at(365), [owner.id])
      return { deleted: deleted.length, row, candidates }
    })
    expect(seen.deleted).toBe(1)
    expect(seen.row).toMatchObject({
      kitasDeletedAt: null,
      deletionHeldUntil: null,
      reminderStage: 1,
      updatedAt: at(100),
    })
    expect(seen.candidates.map((c) => c.subscription.userId)).toEqual([
      owner.id,
    ])
    // Not „Kitas gelöscht“: the year runs on
    expect(statusSummary(seen.row, at(100)).state).toBe('active')
  })

  test('works for an account without a row', async () => {
    const { owner, organizationId } = await newOwnedKita()
    kitas.push(organizationId)
    users.push(owner.id)
    const seen = await rolledBack(async (tx) => ({
      deleted: await deleteKitasNow(tx, owner.id, at(100)),
      row: await findSubscription(tx, owner.id),
    }))
    expect(seen.deleted.map((kita) => kita.id)).toEqual([organizationId])
    expect(seen.row).toBeUndefined()
  })
})

// Left behind when deleting the Kitas of a deleted account failed
describe('Kitas nobody owns', () => {
  const now = new Date()

  // A Kita without an owner, created so many hours ago
  async function ownerless(hoursAgo: number) {
    const id = await newTestKita()
    kitas.push(id)
    await testDb
      .update(organization)
      .set({ createdAt: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000) })
      .where(eq(organization.id, id))
    return id
  }

  async function left(on: Executor, ids: string[]) {
    const rows = await on
      .select({ id: organization.id })
      .from(organization)
      .where(inArray(organization.id, ids))
    return rows.map((row) => row.id).toSorted()
  }

  test('are deleted once they are a day old, with everything in them', async () => {
    const old = await ownerless(25)
    const { id: boardId } = await newTestBoard(old)
    await insertTestNote(boardId)
    // Admins, but nobody who answers for it
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(old, admin.id, 'admin')
    // Being created this moment: no member yet either
    const young = await ownerless(23)
    // Owned, however old
    const owned = await newOwner()
    await testDb
      .update(organization)
      .set({ createdAt: addDays(now, -400) })
      .where(eq(organization.id, owned.organizationId))
    const ids = [old, young, owned.organizationId]

    const seen = await rolledBack(async (tx) => {
      await deleteOwnerlessKitas(now, { on: tx, only: ids })
      return {
        kitas: await left(tx, ids),
        boards: await tx.select().from(board).where(eq(board.id, boardId)),
        admin: await tx.select().from(user).where(eq(user.id, admin.id)),
      }
    })
    expect(seen.kitas).toEqual([young, owned.organizationId].toSorted())
    expect(seen.boards).toEqual([])
    expect(seen.admin).toHaveLength(1)
    expect(logged(info)).toEqual([
      `[hosted] Kita ohne Inhaber:in gelöscht: ${old}`,
    ])
    // Rolled back
    expect(await left(testDb, ids)).toEqual(ids.toSorted())
  })

  test('stay on an instance that is not hosted', async () => {
    instanceMode.hosted = false
    const old = await ownerless(500)
    const kept = await rolledBack(async (tx) => {
      await deleteOwnerlessKitas(now, { on: tx, only: [old] })
      return left(tx, [old])
    })
    expect(kept).toEqual([old])
    expect(logged(info)).toEqual([])
  })

  // The Kitas of an expired account are the run above's business, which
  // announces first
  test('a Kita with an owner is never one of them, whatever the subscription says', async () => {
    const owner = await newOwner()
    await testDb
      .update(organization)
      .set({ createdAt: addDays(now, -400) })
      .where(eq(organization.id, owner.organizationId))
    const kept = await rolledBack(async (tx) => {
      await deleteOwnerlessKitas(addDays(now, 900), {
        on: tx,
        only: [owner.organizationId],
      })
      return left(tx, [owner.organizationId])
    })
    expect(kept).toEqual([owner.organizationId])
  })

  test('the subscription of nobody is touched', async () => {
    const owner = await newOwner()
    const row = await rolledBack(async (tx) => {
      await deleteOwnerlessKitas(addDays(now, 900), {
        on: tx,
        only: [owner.organizationId],
      })
      return findSubscription(tx, owner.id)
    })
    expect(row).toEqual(await subscriptionOf(owner.id))
    expect(row).toMatchObject({
      reminderStage: 0,
      kitasDeletedAt: null,
    })
  })
})
