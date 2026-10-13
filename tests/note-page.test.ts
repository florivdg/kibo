import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { noteCursor } from '@/actions/note-cursor'
import { board, note, organization } from '@/db/schema'
import { NOTE_PAGE_SIZE, notePage } from '@/lib/board/queries'
import { addDays } from '@/lib/board/time'

import { testDb } from './helpers/spam-db'

const TOTAL = NOTE_PAGE_SIZE * 2 + 5
const now = new Date('2026-05-04T10:00:00.000Z')

const organizationId = `test-${randomUUID()}`
const boardId = `test-${randomUUID()}`

beforeAll(async () => {
  await testDb.insert(organization).values({
    id: organizationId,
    name: 'Test-Kita',
    slug: organizationId,
    createdAt: now,
  })
  await testDb.insert(board).values({
    id: boardId,
    organizationId,
    type: 'pinnwand',
    name: 'Testbrett',
  })
  await testDb.insert(note).values(
    Array.from({ length: TOTAL }, (_, index) => ({
      id: `${boardId}-${index}`,
      boardId,
      categoryId: 'hinweis',
      title: `Zettel ${index}`,
      body: 'Text',
      author: 'Test',
      deleteKeyHash: 'x',
      // All within the same second, so the id decides the order too
      createdAt: new Date(now.getTime() - index * 10),
      expiresAt: addDays(now, 14),
    })),
  )
})

afterAll(async () => {
  await testDb.delete(organization).where(eq(organization.id, organizationId))
})

describe('notePage', () => {
  test('hands out at most one page and says that there is more', async () => {
    const first = await notePage(boardId, now)
    expect(first.notes).toHaveLength(NOTE_PAGE_SIZE)
    expect(first.hasMore).toBe(true)
  })

  test('the rest stays reachable and nothing repeats or goes missing', async () => {
    const seen: string[] = []
    let page = await notePage(boardId, now)
    let pages = 1
    seen.push(...page.notes.map((entry) => entry.id))
    while (page.hasMore) {
      const last = page.notes.at(-1)!
      page = await notePage(boardId, now, {
        createdAt: last.createdAt,
        id: last.id,
      })
      pages += 1
      seen.push(...page.notes.map((entry) => entry.id))
    }
    expect(pages).toBe(3)
    expect(seen).toHaveLength(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
  })

  test('keeps the newest-first order across page borders', async () => {
    const first = await notePage(boardId, now)
    const last = first.notes.at(-1)!
    const second = await notePage(boardId, now, {
      createdAt: last.createdAt,
      id: last.id,
    })
    const dates = [...first.notes, ...second.notes].map(
      (entry) => entry.createdAt,
    )
    expect(dates).toEqual([...dates].sort().reverse())
  })

  // M-3: an unparsable timestamp used to reach PostgreSQL as "Invalid Date"
  // and fail the request with a 500 instead of a plain bad request
  test('refuses a cursor that is not a timestamp', () => {
    for (const createdAt of [
      'gestern',
      '',
      '2026-13-45',
      'NaN',
      // Year 0, refused like in push.sync
      '0000-01-01T00:00:00Z',
      '0001-01-01T00:00:00+01:00',
    ]) {
      expect(noteCursor.safeParse({ createdAt, id: 'x' }).success).toBe(false)
    }
    expect(
      noteCursor.safeParse({ createdAt: now.toISOString(), id: 'x' }).success,
    ).toBe(true)
  })

  test('leaves expired notes out', async () => {
    const afterExpiry = addDays(now, 20)
    const page = await notePage(boardId, afterExpiry)
    expect(page.notes).toHaveLength(0)
    expect(page.hasMore).toBe(false)
  })
})
