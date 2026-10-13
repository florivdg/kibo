import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { ActionAPIContext } from 'astro:actions'
import { eq } from 'drizzle-orm'

import { boards } from '@/actions/boards'
import { reports } from '@/actions/reports'
import { board, note, reportCase } from '@/db/schema'
import { boardBudgetKey as key } from '@/lib/board/kita-link'
import { renewKitaLink } from '@/lib/board/mutations'
import { addDays } from '@/lib/board/time'
import { HOSTED_PAUSED_VISITOR } from '@/lib/hosted/messages'
import { instanceMode } from '@/lib/instance'
import { REPORTS_PER_CASE_MAX } from '@/lib/limits'
import { caseAccess, kitaAccess } from '@/lib/reports/access'
import { closeCase, fileReport, reportedNote } from '@/lib/reports/mutations'
import { findCase, listCases, purgeReportCases } from '@/lib/reports/queries'
import {
  REPORT_BOARD_BUDGETS,
  REPORT_CLIENT_BOARD_BUDGETS,
  REPORT_CLIENT_BUDGETS,
  REPORT_CLIENT_NOTE_BUDGETS,
} from '@/lib/spam/budgets'
import { allowClientBoardReport } from '@/lib/spam/guard'

import {
  adminContext,
  refusal,
  signedInContext,
  visitorContext,
} from './helpers/actions'
import {
  addTestMember,
  insertTestNote,
  kitaTokenOf,
  newOwnedKita,
  newTestBoard,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  setTestSubscription,
} from './helpers/fixtures'
import {
  casesOf,
  fileTestReport,
  notificationsOf,
  reportsOf,
} from './helpers/reports'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// Reporting a note (notes.report) and handling the case (reports.close), run
// the way Astro runs the actions on the server, against the local
// PostgreSQL. Every test works on Kitas and accounts of its own.

const kitas: string[] = []
const users: string[] = []

// A Kita with its owner, an admin and a board with one note on it
async function newKita() {
  const { organizationId, owner } = await newOwnedKita()
  const admin = await newTestUser()
  await addTestMember(organizationId, admin.id, 'admin')
  kitas.push(organizationId)
  users.push(owner.id, admin.id)
  const target = await newTestBoard(organizationId)
  const noteId = await insertTestNote(target.id, {
    title: 'Fahrrad zu verkaufen',
    body: 'Ruft an unter 0170 1234567',
    author: 'Max',
    contact: 'max@example.org',
  })
  return { organizationId, owner, admin, board: target, noteId }
}

function noteRow(id: string) {
  return testDb.select().from(note).where(eq(note.id, id))
}

beforeEach(resetSpamCounters)

afterEach(() => {
  instanceMode.hosted = false
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('notes.report', () => {
  test('opens a case with the note as the server has it, and mails for its owner and admins', async () => {
    const kita = await newKita()
    // A member without either role is no recipient
    const other = await newTestUser()
    users.push(other.id)
    await addTestMember(kita.organizationId, other.id, 'member' as 'admin')

    expect(
      await fileTestReport(kita.board.link, kita.noteId, {
        reason: 'personal-data',
        remarks: '  Da steht eine Handynummer.  ',
      }),
    ).toBeUndefined()

    const [found, ...more] = await casesOf(kita.organizationId)
    expect(more).toEqual([])
    expect(found).toMatchObject({
      boardId: kita.board.id,
      noteId: kita.noteId,
      noteTitle: 'Fahrrad zu verkaufen',
      noteBody: 'Ruft an unter 0170 1234567',
      noteAuthor: 'Max',
      noteContact: 'max@example.org',
      status: 'open',
      reportCount: 1,
    })
    const kept = await reportsOf(found!.id)
    expect(kept.map(({ reason, remarks }) => ({ reason, remarks }))).toEqual([
      { reason: 'personal-data', remarks: 'Da steht eine Handynummer.' },
    ])
    const queued = await notificationsOf(kita.organizationId)
    expect(queued.map((row) => row.userId).toSorted()).toEqual(
      [kita.owner.id, kita.admin.id].toSorted(),
    )
    expect(queued.every((row) => row.status === 'pending')).toBe(true)
    // The note stays on the board until somebody decides
    expect(await noteRow(kita.noteId)).toHaveLength(1)
  })

  test('further reports of the open case count on it, without new mails', async () => {
    const kita = await newKita()
    await fileTestReport(kita.board.link, kita.noteId)
    await fileTestReport(kita.board.link, kita.noteId, { reason: 'offensive' })
    await fileTestReport(kita.board.link, kita.noteId, { reason: 'other' })

    const [found, ...more] = await casesOf(kita.organizationId)
    expect(more).toEqual([])
    expect(found!.reportCount).toBe(3)
    expect((await reportsOf(found!.id)).map((row) => row.reason)).toEqual([
      'spam',
      'offensive',
      'other',
    ])
    expect(await notificationsOf(kita.organizationId)).toHaveLength(2)
  })

  test('parallel reports make one case and one set of mails', async () => {
    const kita = await newKita()
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        fileTestReport(kita.board.link, kita.noteId),
      ),
    )
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    const [found, ...more] = await casesOf(kita.organizationId)
    expect(more).toEqual([])
    expect(found!.reportCount).toBe(10)
    expect(await reportsOf(found!.id)).toHaveLength(10)
    expect(await notificationsOf(kita.organizationId)).toHaveLength(2)
  })

  test('keeps the same remarks once, and only so many reports with their details', async () => {
    const kita = await newKita()
    await fileTestReport(kita.board.link, kita.noteId, {
      remarks: 'Das ist Werbung!',
    })
    await fileTestReport(kita.board.link, kita.noteId, {
      remarks: 'das ist   werbung',
    })
    const [found] = await casesOf(kita.organizationId)
    expect((await reportsOf(found!.id)).map((row) => row.remarks)).toEqual([
      'Das ist Werbung!',
      '',
    ])

    for (let i = 0; i < REPORTS_PER_CASE_MAX; i++) {
      await fileTestReport(kita.board.link, kita.noteId)
      // The board's own budget is not what this is about
      if (i % 20 === 19) await resetSpamCounters()
    }
    const [counted] = await casesOf(kita.organizationId)
    expect(counted!.reportCount).toBe(REPORTS_PER_CASE_MAX + 2)
    expect(await reportsOf(found!.id)).toHaveLength(REPORTS_PER_CASE_MAX)
  })

  test('reports nothing for a note that ran out, belongs to another board or is gone', async () => {
    const kita = await newKita()
    const expired = await insertTestNote(kita.board.id, {
      createdAt: addDays(new Date(), -20),
    })
    const elsewhere = await newTestBoard(kita.organizationId)
    const foreign = await insertTestNote(elsewhere.id)
    const otherKita = await newKita()

    for (const noteId of [expired, foreign, otherKita.noteId, 'nope']) {
      expect(
        await refusal(fileTestReport(kita.board.link, noteId)),
      ).toMatchObject({ code: 'NOT_FOUND', status: 404 })
    }
    expect(await casesOf(kita.organizationId)).toEqual([])
    expect(await casesOf(otherKita.organizationId)).toEqual([])
  })

  test('an old link reports nothing once the Kita has a new one', async () => {
    const kita = await newKita()
    const oldLink = kita.board.link
    await boards.renewKitaLink.orThrow.call(
      adminContext(kita.organizationId),
      undefined,
    )
    const kitaToken = await kitaTokenOf(kita.organizationId)

    expect(await refusal(fileTestReport(oldLink, kita.noteId))).toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await casesOf(kita.organizationId)).toEqual([])
    await fileTestReport({ ...oldLink, kitaToken }, kita.noteId)
    expect(await casesOf(kita.organizationId)).toHaveLength(1)
  })

  test("a board of another Kita isn't reached through this Kita's link", async () => {
    const kita = await newKita()
    const otherKita = await newKita()
    const across = { ...kita.board.link, boardId: otherKita.board.id }
    expect(
      await refusal(fileTestReport(across, otherKita.noteId)),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(await casesOf(otherKita.organizationId)).toEqual([])
  })

  test('validates the reason and the remarks on the server', async () => {
    const kita = await newKita()
    const call = (input: Record<string, unknown>) =>
      fileTestReport(kita.board.link, kita.noteId, input as never)
    // The schema throws before the handler runs
    const invalid = async (input: Record<string, unknown>) => {
      try {
        await call(input)
        return false
      } catch {
        return true
      }
    }
    expect(await invalid({ reason: '' })).toBe(true)
    expect(await invalid({ reason: 'langweilig' })).toBe(true)
    expect(await invalid({ remarks: 'x'.repeat(501) })).toBe(true)
    // A bidi override, which could turn the text around on the admin page
    expect(await invalid({ remarks: 'Hallo \u202Eolla' })).toBe(true)
    // The honeypot: a bot is refused like any invalid input
    expect(await refusal(call({ website: 'https://spam.example' }))).toEqual({
      code: 'BAD_REQUEST',
      status: 400,
      message: 'BAD_REQUEST',
    })
    expect(await casesOf(kita.organizationId)).toEqual([])
  })

  test('a board of a paused Kita takes no reports', async () => {
    const kita = await newKita()
    await setTestSubscription(kita.owner.id, 'paused')
    instanceMode.hosted = true
    expect(await refusal(fileTestReport(kita.board.link, kita.noteId))).toEqual(
      {
        code: 'PAYMENT_REQUIRED',
        status: 402,
        message: HOSTED_PAUSED_VISITOR,
      },
    )
    expect(await casesOf(kita.organizationId)).toEqual([])
  })

  test('one network reports the same note only a few times', async () => {
    const kita = await newKita()
    const context = visitorContext('203.0.113.50')
    const max = REPORT_CLIENT_NOTE_BUDGETS[0]!.max
    for (let i = 0; i < max; i++) {
      await fileTestReport(kita.board.link, kita.noteId, { context })
    }
    const refused = await refusal(
      fileTestReport(kita.board.link, kita.noteId, { context }),
    )
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    expect(refused!.message).toContain('schon gemeldet')
    const [found] = await casesOf(kita.organizationId)
    expect(found!.reportCount).toBe(max)
  })

  test('the network budget is spent before the board is looked up', async () => {
    const kita = await newKita()
    const context = visitorContext('203.0.113.51')
    const hourly = REPORT_CLIENT_BUDGETS[0]!.max
    // Made-up links cost as much as real reports
    for (let i = 0; i < hourly; i++) {
      expect(
        await refusal(
          fileTestReport(
            { ...kita.board.link, kitaToken: 'erfunden-erfunden-erfunden' },
            kita.noteId,
            { context },
          ),
        ),
      ).toMatchObject({ code: 'NOT_FOUND' })
    }
    const refused = await refusal(
      fileTestReport(kita.board.link, kita.noteId, { context }),
    )
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect(refused!.message).toContain('ungewöhnlich viele Zettel gemeldet')
    expect(await casesOf(kita.organizationId)).toEqual([])
  })

  test('a board takes only so many reports in all, and a note that is gone uses none of them', async () => {
    const kita = await newKita()
    const expired = await insertTestNote(kita.board.id, {
      createdAt: addDays(new Date(), -20),
    })
    // Reports of notes that aren't there are rolled back with the budget
    for (const noteId of [expired, 'nope', expired, 'nope', expired]) {
      expect(
        await refusal(fileTestReport(kita.board.link, noteId)),
      ).toMatchObject({ code: 'NOT_FOUND' })
    }
    // Every report from a network of its own: only the board's budget counts
    const hourly = REPORT_BOARD_BUDGETS[0]!.max
    for (let i = 0; i < hourly; i++) {
      expect(
        await refusal(fileTestReport(kita.board.link, kita.noteId)),
      ).toBeNull()
    }
    const refused = await refusal(fileTestReport(kita.board.link, kita.noteId))
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    const [found] = await casesOf(kita.organizationId)
    expect(found!.reportCount).toBe(hourly)
  })

  test('one network reports only so much on one board', async () => {
    const kita = await newKita()
    const client = 'test-network-board'
    const now = new Date()
    const max = REPORT_CLIENT_BOARD_BUDGETS[0]!.max
    for (let i = 0; i < max; i++) {
      expect(
        (await allowClientBoardReport(client, key(kita.board.link), now))
          .allowed,
      ).toBe(true)
    }
    expect(
      (await allowClientBoardReport(client, key(kita.board.link), now)).allowed,
    ).toBe(false)
    // Another board of the Kita is another budget …
    const elsewhere = await newTestBoard(kita.organizationId)
    expect(
      (await allowClientBoardReport(client, key(elsewhere.link), now)).allowed,
    ).toBe(true)
    // … and so is the same board once the Kita has a new link
    await renewKitaLink(kita.organizationId)
    const kitaToken = await kitaTokenOf(kita.organizationId)
    expect(
      (
        await allowClientBoardReport(
          client,
          key({ ...kita.board.link, kitaToken }),
          now,
        )
      ).allowed,
    ).toBe(true)
  })

  test('the case outlives its note, and goes with its board', async () => {
    const kita = await newKita()
    await fileTestReport(kita.board.link, kita.noteId)
    await testDb.delete(note).where(eq(note.id, kita.noteId))
    const [kept] = await casesOf(kita.organizationId)
    expect(kept).toMatchObject({
      noteId: null,
      noteTitle: 'Fahrrad zu verkaufen',
      status: 'open',
    })
    const detail = await findCase(kita.organizationId, kept!.id, new Date())
    expect(detail?.hanging).toBe(false)

    await testDb.delete(board).where(eq(board.id, kita.board.id))
    expect(await casesOf(kita.organizationId)).toEqual([])
    expect(await notificationsOf(kita.organizationId)).toEqual([])
  })
})

test('deleting the Kita deletes its reports and their mails', async () => {
  const kita = await newKita()
  await fileTestReport(kita.board.link, kita.noteId, { remarks: 'Bitte weg' })
  const [found] = await casesOf(kita.organizationId)
  expect(await reportsOf(found!.id)).toHaveLength(1)
  expect(await notificationsOf(kita.organizationId)).toHaveLength(2)

  await removeTestKitas(kita.organizationId)
  expect(await casesOf(kita.organizationId)).toEqual([])
  expect(await reportsOf(found!.id)).toEqual([])
  expect(await notificationsOf(kita.organizationId)).toEqual([])
})

describe('reports.close', () => {
  async function reportedKita() {
    const kita = await newKita()
    await fileTestReport(kita.board.link, kita.noteId)
    const [found] = await casesOf(kita.organizationId)
    return { ...kita, caseId: found!.id }
  }

  test('takes the note down and closes the case in one step', async () => {
    const kita = await reportedKita()
    const closed = await reports.close.orThrow.call(
      signedInContext(kita.admin.id, kita.organizationId),
      { caseId: kita.caseId, removeNote: true },
    )
    expect(closed).toEqual({ resolution: 'removed', noteRemoved: true })
    expect(await noteRow(kita.noteId)).toEqual([])
    const [found] = await casesOf(kita.organizationId)
    expect(found).toMatchObject({
      status: 'closed',
      resolution: 'removed',
      closedBy: kita.admin.id,
      noteId: null,
      noteBody: 'Ruft an unter 0170 1234567',
    })
  })

  test('closes without taking the note down', async () => {
    const kita = await reportedKita()
    expect(
      await reports.close.orThrow.call(
        signedInContext(kita.owner.id, kita.organizationId),
        { caseId: kita.caseId, removeNote: false },
      ),
    ).toEqual({ resolution: 'kept', noteRemoved: false })
    expect(await noteRow(kita.noteId)).toHaveLength(1)
    // Reported again, the note gets a case of its own
    await fileTestReport(kita.board.link, kita.noteId)
    const cases = await casesOf(kita.organizationId)
    expect(cases.map((row) => row.status)).toEqual(['closed', 'open'])
    expect(await notificationsOf(kita.organizationId)).toHaveLength(4)
  })

  test('a note that is gone already does not stand in the way', async () => {
    const kita = await reportedKita()
    await testDb.delete(note).where(eq(note.id, kita.noteId))
    expect(
      await reports.close.orThrow.call(
        signedInContext(kita.owner.id, kita.organizationId),
        { caseId: kita.caseId, removeNote: true },
      ),
    ).toEqual({ resolution: 'kept', noteRemoved: false })
    // Nobody removed anything: the case doesn't say so either
    const [found] = await casesOf(kita.organizationId)
    expect(found).toMatchObject({ status: 'closed', resolution: 'kept' })
  })

  test('a report under way and the close of its case wait for each other, not forever', async () => {
    const kita = await reportedKita()
    let closing: ReturnType<typeof closeCase> | undefined
    // A report holds the note, as notes.report does, while the case is
    // closed with the note taken down
    await testDb.transaction(async (tx) => {
      const held = await reportedNote(
        tx,
        kita.board.id,
        kita.noteId,
        new Date(),
      )
      closing = closeCase(
        kita.organizationId,
        kita.caseId,
        { userId: kita.owner.id, removeNote: true },
        new Date(),
      )
      // Time for the close to reach the note
      await new Promise((resolve) => setTimeout(resolve, 300))
      await fileReport(
        tx,
        { organizationId: kita.organizationId, boardId: kita.board.id },
        held!,
        { reason: 'spam', remarks: '' },
        new Date(),
      )
    })
    // The report counted on the open case, then the close went through
    expect(await closing).toEqual({ resolution: 'removed', noteRemoved: true })
    const [found] = await casesOf(kita.organizationId)
    expect(found).toMatchObject({ status: 'closed', reportCount: 2 })
    expect(await noteRow(kita.noteId)).toEqual([])
    // A report that comes after finds nothing to report
    expect(
      await refusal(fileTestReport(kita.board.link, kita.noteId)),
    ).toMatchObject({ code: 'NOT_FOUND' })
  })

  test('works while the hosted instance has paused the Kita', async () => {
    const kita = await reportedKita()
    await setTestSubscription(kita.owner.id, 'paused')
    instanceMode.hosted = true
    await reports.close.orThrow.call(
      signedInContext(kita.admin.id, kita.organizationId),
      { caseId: kita.caseId, removeNote: true },
    )
    expect(await noteRow(kita.noteId)).toEqual([])
  })

  test('refuses without a session, outside the Kita and for another Kita’s case', async () => {
    const kita = await reportedKita()
    const other = await reportedKita()
    const input = { caseId: kita.caseId, removeNote: true }

    expect(
      await refusal(
        reports.close.orThrow.call(
          { locals: {} } as unknown as ActionAPIContext,
          input,
        ),
      ),
    ).toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    // Signed in, but the active Kita is none of theirs
    expect(
      await refusal(
        reports.close.orThrow.call(
          signedInContext(other.owner.id, kita.organizationId),
          input,
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    // Without an active Kita
    expect(
      await refusal(
        reports.close.orThrow.call(signedInContext(kita.owner.id), input),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' })
    // Their own Kita active, the id of the other one's case
    expect(
      await refusal(
        reports.close.orThrow.call(
          signedInContext(other.owner.id, other.organizationId),
          input,
        ),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 })

    expect(await noteRow(kita.noteId)).toHaveLength(1)
    const [untouched] = await casesOf(kita.organizationId)
    expect(untouched!.status).toBe('open')
  })

  test('a case that is closed already answers 404', async () => {
    const kita = await reportedKita()
    const context = signedInContext(kita.owner.id, kita.organizationId)
    await reports.close.orThrow.call(context, {
      caseId: kita.caseId,
      removeNote: false,
    })
    expect(
      await refusal(
        reports.close.orThrow.call(context, {
          caseId: kita.caseId,
          removeNote: true,
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' })
    expect(await noteRow(kita.noteId)).toHaveLength(1)
  })
})

describe('the admin pages', () => {
  test('list and show the cases of the Kita asked for only', async () => {
    const kita = await newKita()
    const other = await newKita()
    await fileTestReport(kita.board.link, kita.noteId)
    await fileTestReport(other.board.link, other.noteId)
    const now = new Date()

    const open = await listCases(kita.organizationId, 'open', now)
    expect(open.total).toBe(1)
    expect(open.cases).toHaveLength(1)
    expect(open.cases[0]).toMatchObject({ reportCount: 1, hanging: true })
    expect(await listCases(kita.organizationId, 'closed', now)).toEqual({
      cases: [],
      total: 0,
    })

    const [foreign] = await casesOf(other.organizationId)
    expect(await findCase(kita.organizationId, foreign!.id, now)).toBe(
      undefined,
    )
  })

  test('the overview lists the newest cases and counts them all', async () => {
    const kita = await newKita()
    const now = new Date()
    const many = 203
    await testDb.insert(reportCase).values(
      Array.from({ length: many }, (_, i) => ({
        organizationId: kita.organizationId,
        boardId: kita.board.id,
        noteCategoryId: 'hinweis',
        noteTitle: `Zettel ${i}`,
        noteBody: 'B',
        noteAuthor: 'A',
        noteCreatedAt: addDays(now, -2),
        noteExpiresAt: addDays(now, 5),
        firstReportedAt: new Date(now.getTime() - i * 60_000),
        lastReportedAt: new Date(now.getTime() - i * 60_000),
      })),
    )
    const { cases, total } = await listCases(kita.organizationId, 'open', now)
    expect(total).toBe(many)
    expect(cases.length).toBeLessThan(many)
    expect(cases[0]!.noteTitle).toBe('Zettel 0')
  })

  test('the link of a mail switches to the Kita of the case, for its team only', async () => {
    const kita = await newKita()
    const other = await newKita()
    await fileTestReport(kita.board.link, kita.noteId)
    const [found] = await casesOf(kita.organizationId)
    // The admin of both Kitas, with the other one active
    await addTestMember(other.organizationId, kita.admin.id, 'admin')

    expect(
      await caseAccess(found!.id, kita.admin.id, kita.organizationId),
    ).toEqual({ kind: 'show' })
    expect(
      await caseAccess(found!.id, kita.admin.id, other.organizationId),
    ).toEqual({ kind: 'switch', organizationId: kita.organizationId })
    expect(
      await caseAccess(found!.id, other.owner.id, other.organizationId),
    ).toEqual({ kind: 'none' })
    expect(await caseAccess('unbekannt', kita.admin.id, undefined)).toEqual({
      kind: 'none',
    })

    expect(
      await kitaAccess(
        kita.organizationId,
        kita.admin.id,
        other.organizationId,
      ),
    ).toEqual({ kind: 'switch', organizationId: kita.organizationId })
    expect(
      await kitaAccess(kita.organizationId, other.owner.id, undefined),
    ).toEqual({ kind: 'none' })
  })
})

describe('purgeReportCases', () => {
  test('deletes closed cases after 30 days and every case 90 days after its first report', async () => {
    const kita = await newKita()
    const now = new Date()
    const days = (n: number) => addDays(now, -n)
    const base = {
      organizationId: kita.organizationId,
      boardId: kita.board.id,
      noteCategoryId: 'hinweis',
      noteTitle: 'T',
      noteBody: 'B',
      noteAuthor: 'A',
      noteCreatedAt: days(100),
      noteExpiresAt: days(70),
    }
    const rows = {
      closedLongAgo: { firstReportedAt: days(40), closedAt: days(31) },
      closedLately: { firstReportedAt: days(40), closedAt: days(29) },
      openTooLong: { firstReportedAt: days(91), closedAt: null },
      openStill: { firstReportedAt: days(89), closedAt: null },
    }
    const ids: Record<string, string> = {}
    for (const [name, dates] of Object.entries(rows)) {
      const [inserted] = await testDb
        .insert(reportCase)
        .values({
          ...base,
          ...dates,
          lastReportedAt: dates.firstReportedAt,
          status: dates.closedAt ? 'closed' : 'open',
          resolution: dates.closedAt ? 'kept' : null,
        })
        .returning({ id: reportCase.id })
      ids[name] = inserted!.id
    }

    expect(await purgeReportCases(now, { only: [kita.organizationId] })).toBe(2)
    const left = (await casesOf(kita.organizationId)).map((row) => row.id)
    expect(left.toSorted()).toEqual(
      [ids.closedLately, ids.openStill].toSorted(),
    )
  })
})
