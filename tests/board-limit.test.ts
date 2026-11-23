import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'

import { boards } from '@/actions/boards'
import { db } from '@/db'
import { board } from '@/db/schema'
import { countBoards, findPublicKita, listBoards } from '@/lib/board/queries'
import { BOARD_LIMIT, BOARD_LIMIT_MESSAGE } from '@/lib/limits'

import { adminContext, refusal } from './helpers/actions'
import { kitaTokenOf, newTestKita, removeTestKitas } from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// At most BOARD_LIMIT boards per Kita (boards.create, createBoard in
// src/lib/board/mutations.ts), counted under a lock on the Kita's row, so a
// burst of parallel creates can't overshoot it. Against the local PostgreSQL.

const FULL = { code: 'CONFLICT', status: 409, message: BOARD_LIMIT_MESSAGE }
const BURST = 10

const kitas: string[] = []

async function newKita() {
  const id = await newTestKita()
  kitas.push(id)
  return id
}

// Boards straight into the database, past what the action allows
async function seedBoards(organizationId: string, count: number) {
  await testDb.insert(board).values(
    Array.from({ length: count }, (_, index) => ({
      organizationId,
      type: 'pinnwand' as const,
      name: `Gruppe ${index + 1}`,
    })),
  )
}

function create(organizationId: string) {
  return boards.create.orThrow.call(adminContext(organizationId), {
    type: 'pinnwand',
    name: 'Neues Brett',
    description: '',
  })
}

afterAll(() => removeTestKitas(...kitas))

describe('boards.create', () => {
  test('takes BOARD_LIMIT boards and refuses the next', async () => {
    const kita = await newKita()
    for (let index = 0; index < BOARD_LIMIT; index++) {
      expect(await create(kita)).toEqual({ id: expect.any(String) })
    }

    expect(await refusal(create(kita))).toEqual(FULL)
    expect(await countBoards(kita, testDb)).toBe(BOARD_LIMIT)
  })

  test('a parallel burst one below the limit makes exactly one board', async () => {
    const kita = await newKita()
    await seedBoards(kita, BOARD_LIMIT - 1)
    // Every create gets a connection of the app's pool that is already open,
    // so they really run side by side. BURST must not exceed the pool's `max`
    // (10, src/db/index.ts), or the creates queue for a connection instead.
    await Promise.all(
      Array.from({ length: BURST }, () =>
        db.execute(sql`select pg_sleep(0.05)`),
      ),
    )

    const results = await Promise.all(
      Array.from({ length: BURST }, () => refusal(create(kita))),
    )

    expect(results.filter((result) => result === null)).toHaveLength(1)
    expect(results.filter(Boolean)).toEqual(Array(BURST - 1).fill(FULL))
    expect(await countBoards(kita, testDb)).toBe(BOARD_LIMIT)
  })

  test('deleting a board at the limit makes room for one more', async () => {
    const kita = await newKita()
    await seedBoards(kita, BOARD_LIMIT)
    expect(await refusal(create(kita))).toEqual(FULL)

    const [goes] = await listBoards(kita, new Date())
    await boards.remove.orThrow.call(adminContext(kita), { id: goes!.id })

    expect(await create(kita)).toEqual({ id: expect.any(String) })
    expect(await refusal(create(kita))).toEqual(FULL)
    expect(await countBoards(kita, testDb)).toBe(BOARD_LIMIT)
  })

  test('a Kita above the limit keeps and lists all its boards', async () => {
    const kita = await newKita()
    const above = BOARD_LIMIT + 3
    await seedBoards(kita, above)
    const now = new Date()

    expect(await refusal(create(kita))).toEqual(FULL)
    expect(await listBoards(kita, now)).toHaveLength(above)
    const page = await findPublicKita(await kitaTokenOf(kita), now)
    if (!page || page.paused) throw new Error('Kita page missing or paused')
    expect(page.boards).toHaveLength(above)
  })
})
