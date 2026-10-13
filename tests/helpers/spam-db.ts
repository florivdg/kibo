import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from '@/db/schema'
import {
  board,
  note,
  organization,
  spamCounter,
  spamFingerprint,
  spamKey,
} from '@/db/schema'
import type { Database } from '@/db/types'
import { addDays } from '@/lib/board/time'
import { createSpamStore } from '@/lib/spam/store'

// The local PostgreSQL from `bun run db:up`, migrated with `bun run db:migrate`
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://kibo:kibo_dev_password@localhost:5432/kibo'

// allowExitOnIdle: the suite never closes the pool, because all test files
// share this module; an idle pool must not keep the runner alive.
const testPool = new Pool({
  connectionString,
  max: 8,
  allowExitOnIdle: true,
})
export const testDb: Database = drizzle({ client: testPool, schema })

export async function resetSpamTables() {
  await resetSpamCounters()
  await testDb.delete(spamKey)
}

// Keeps the keys. For tests of the app's own store (src/lib/spam/guard.ts),
// which caches its keys: pulling them away underneath it would split one
// test's counters over two keys, something no running instance ever sees.
export async function resetSpamCounters() {
  await testDb.delete(spamCounter)
  await testDb.delete(spamFingerprint)
}

// A second store on the same database stands in for a second app process (or
// for the same process after a restart): it shares nothing but the tables.
export function newProcess() {
  return createSpamStore(testDb)
}

// Adds a key that becomes the one writes are made with, the way rotating the
// spam key in production does. createdAt can be set to put a key into the
// past — a store's first key made long ago, or a rotation at a given moment;
// by default a second from now, so ordering by createdAt is unambiguous.
export async function rotateKey(createdAt = new Date(Date.now() + 1000)) {
  const id = randomUUID()
  await testDb.insert(spamKey).values({
    id,
    secret: Buffer.from(randomUUID().repeat(2)).toString('base64'),
    createdAt,
  })
  return id
}

export async function keyIds() {
  const rows = await testDb.select({ id: spamKey.id }).from(spamKey)
  return rows.map((row) => row.id)
}

// A fingerprint points at the note it belongs to, so the store tests need real
// notes to hang their claims on. One board, created on first use.
const BOARD_ID = 'spam-test-board'
let prepared: Promise<void> | undefined

function prepareBoard() {
  prepared ??= (async () => {
    await testDb
      .insert(organization)
      .values({
        id: BOARD_ID,
        name: 'Testkita',
        slug: BOARD_ID,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
    await testDb
      .insert(board)
      .values({
        id: BOARD_ID,
        organizationId: BOARD_ID,
        type: 'pinnwand',
        name: 'Testbrett',
      })
      .onConflictDoNothing()
  })()
  return prepared
}

// Removes that board again after a test file is done; its notes and their
// fingerprints go with the Kita. The next file to need it creates it anew.
export async function removeTestBoard() {
  await testDb.delete(organization).where(eq(organization.id, BOARD_ID))
  prepared = undefined
}

export async function newNoteId() {
  await prepareBoard()
  const now = new Date()
  const [created] = await testDb
    .insert(note)
    .values({
      boardId: BOARD_ID,
      categoryId: 'hinweis',
      title: 'Test',
      body: 'Test',
      author: 'Test',
      deleteKeyHash: 'x',
      createdAt: now,
      expiresAt: addDays(now, 14),
    })
    .returning({ id: note.id })
  return created!.id
}
