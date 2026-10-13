import { randomUUID } from 'node:crypto'

import { eq, inArray, TransactionRollbackError } from 'drizzle-orm'

import {
  board,
  hostedSubscription,
  member,
  note,
  organization,
  pushSubscription,
  user,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { kitaLinkOf } from '@/lib/board/kita-link'
import { addDays } from '@/lib/board/time'
import type { SubscriptionState } from '@/lib/hosted/state'
import { findSubscription } from '@/lib/hosted/subscriptions'
import { ADMIN_ROLE, OWNER_ROLE } from '@/lib/organization-roles'

import { testDb } from './spam-db'

// Rows for the tests that need a Kita, boards and notes in the database.
// Every test file makes a Kita of its own and removes it at the end: its
// link, boards, notes and push subscriptions go with it (foreign keys).

// The Kita's link, made on the first ask like the admin pages do
export async function kitaTokenOf(
  organizationId: string,
  on: Executor = testDb,
) {
  return (await kitaLinkOf(organizationId, on)).token
}

// A Kita with its link, as the first visit of its admin pages leaves it
export async function newTestKita() {
  const id = `test-${randomUUID()}`
  await testDb
    .insert(organization)
    .values({ id, name: 'Test-Kita', slug: id, createdAt: new Date() })
  await kitaTokenOf(id)
  return id
}

export async function removeTestKitas(...ids: string[]) {
  await testDb.delete(organization).where(inArray(organization.id, ids))
}

// A board with a real UUID (so notifications get a Topic), and the Kita
// link it is reached through: { kitaToken, boardId } is what the public
// actions take
export async function newTestBoard(
  organizationId: string,
  values: Partial<typeof board.$inferInsert> = {},
) {
  const id = randomUUID()
  await testDb.insert(board).values({
    id,
    organizationId,
    type: 'pinnwand',
    name: 'Igelgruppe',
    ...values,
  })
  const kitaToken = await kitaTokenOf(organizationId)
  return { id, kitaToken, link: { kitaToken, boardId: id } }
}

export async function insertTestNote(
  boardId: string,
  values: Partial<typeof note.$inferInsert> = {},
) {
  const createdAt = values.createdAt ?? new Date()
  const [created] = await testDb
    .insert(note)
    .values({
      boardId,
      categoryId: 'hinweis',
      title: 'Test',
      body: 'Test',
      author: 'Test',
      deleteKeyHash: 'x',
      createdAt,
      expiresAt: addDays(createdAt, 14),
      ...values,
    })
    .returning({ id: note.id })
  return created!.id
}

export function subscribersOf(boardId: string) {
  return testDb
    .select()
    .from(pushSubscription)
    .where(eq(pushSubscription.boardId, boardId))
    .orderBy(pushSubscription.endpoint)
}

// An account as the database has it, for tests that need an owner or an
// admin but no sign-in (tests/helpers/auth.ts makes the ones that sign in).
// Removing it takes its memberships and its subscription along.
export async function newTestUser() {
  const id = `test-${randomUUID()}`
  const email = `${id}@kita.example`
  const name = 'Test'
  const now = new Date()
  await testDb.insert(user).values({
    id,
    name,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return { id, name, email }
}

export async function removeTestUsers(...ids: string[]) {
  await testDb.delete(user).where(inArray(user.id, ids))
}

export async function addTestMember(
  organizationId: string,
  userId: string,
  role: typeof OWNER_ROLE | typeof ADMIN_ROLE = OWNER_ROLE,
) {
  await testDb.insert(member).values({
    id: `test-${randomUUID()}`,
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

// A Kita with the account that owns it, as creating one through the API
// leaves them. Both are removed by the test that made them.
export async function newOwnedKita() {
  const owner = await newTestUser()
  const organizationId = await newTestKita()
  await addTestMember(organizationId, owner.id)
  return { organizationId, owner }
}

// Dates that put a subscription of the hosted instance into the given state
// at `now` (src/lib/hosted/state.ts), well clear of every bound
function subscriptionDates(state: SubscriptionState, now: Date) {
  const trialEnded = { trial: -10, active: 200, grace: 5, paused: 20 }
  if (state === 'active') {
    return { trialEndsAt: addDays(now, -200), paidUntil: addDays(now, 100) }
  }
  const daysAgo = state === 'deletable' ? 100 : trialEnded[state]
  return { trialEndsAt: addDays(now, -daysAgo), paidUntil: null }
}

export async function setTestSubscription(
  userId: string,
  state: SubscriptionState,
  now = new Date(),
) {
  const dates = subscriptionDates(state, now)
  await testDb
    .insert(hostedSubscription)
    .values({ userId, ...dates })
    .onConflictDoUpdate({
      target: hostedSubscription.userId,
      set: { ...dates, complimentary: false },
    })
}

export function subscriptionOf(userId: string) {
  return findSubscription(testDb, userId)
}

// Runs `run` in a transaction that is rolled back, and hands on what it saw.
// For what looks at every account or Kita of the database — the hourly runs
// of the hosted instance — so the rows of other tests and of the dev server
// stay as they were.
export async function rolledBack<T>(run: (tx: Executor) => Promise<T>) {
  let seen: T | undefined
  try {
    await testDb.transaction(async (tx) => {
      seen = await run(tx)
      tx.rollback()
    })
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error
  }
  return seen as T
}
