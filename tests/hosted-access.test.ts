import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { hostedSubscription } from '@/db/schema'
import {
  findBoardPage,
  findKita,
  findLinkedBoard,
  findPublicBoard,
  findPublicKita,
} from '@/lib/board/queries'
import { addBerlinDays, addDays, longDate } from '@/lib/board/time'
import {
  hostedKitaCreation,
  isKitaPaused,
  kitaCreationForm,
  kitaOwnerSubscription,
  startMissingSubscriptions,
} from '@/lib/hosted/access'
import { subscriptionNotice } from '@/lib/hosted/notice'
import type { SubscriptionState } from '@/lib/hosted/state'
import {
  ensureSubscription,
  findSubscription,
} from '@/lib/hosted/subscriptions'
import { hostedPricing, instanceMode } from '@/lib/instance'
import { GET as manifest } from '@/pages/k/[kita]/manifest.webmanifest'

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
  setTestSubscription,
  subscriptionOf,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// The one place that decides whether a Kita of the hosted instance is paused
// (src/lib/hosted/access.ts), what the admin area says about it, the reads of
// a board that ask it, and where subscriptions come from. Against the local
// PostgreSQL.
const now = new Date('2026-05-04T10:00:00.000Z')
const STATES: SubscriptionState[] = [
  'trial',
  'active',
  'grace',
  'paused',
  'deletable',
]

const kitas: string[] = []
const users: string[] = []

// A Kita of its own per test, with the owner's subscription in the given
// state — or without one
async function kitaIn(state?: SubscriptionState, at = now) {
  const { organizationId, owner } = await newOwnedKita()
  kitas.push(organizationId)
  users.push(owner.id)
  if (state) await setTestSubscription(owner.id, state, at)
  return { organizationId, owner }
}

// The notice as the middleware makes it: from one look at the Kita's owner
async function noticeFor(organizationId: string, userId: string, at: Date) {
  return subscriptionNotice(
    await kitaOwnerSubscription(organizationId),
    userId,
    at,
  )
}

async function manifestStatus(kita: string) {
  const response = await manifest({
    params: { kita },
  } as unknown as Parameters<typeof manifest>[0])
  return response.status
}

beforeEach(() => {
  instanceMode.hosted = true
})

afterEach(() => {
  instanceMode.hosted = false
  hostedPricing.trialDays = 30
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('isKitaPaused', () => {
  test('pauses a Kita once its owner is past the grace period', async () => {
    const paused: Record<string, boolean> = {}
    for (const state of STATES) {
      const { organizationId } = await kitaIn(state)
      paused[state] = await isKitaPaused(organizationId, now)
    }
    expect(paused).toEqual({
      trial: false,
      active: false,
      grace: false,
      paused: true,
      deletable: true,
    })
  })

  test('follows the clock, not a stored state', async () => {
    const { organizationId, owner } = await kitaIn()
    const trialEndsAt = new Date('2026-06-01T00:00:00.000Z')
    await testDb
      .insert(hostedSubscription)
      .values({ userId: owner.id, trialEndsAt })
    const pausesAt = addDays(trialEndsAt, 14)
    expect(
      await isKitaPaused(organizationId, new Date(pausesAt.getTime() - 1)),
    ).toBe(false)
    expect(await isKitaPaused(organizationId, pausesAt)).toBe(true)
  })

  test('an account that is free for good is never paused', async () => {
    const { organizationId, owner } = await kitaIn('deletable')
    expect(await isKitaPaused(organizationId, now)).toBe(true)
    await testDb
      .update(hostedSubscription)
      .set({ complimentary: true })
      .where(eq(hostedSubscription.userId, owner.id))
    expect(await isKitaPaused(organizationId, now)).toBe(false)
  })

  test('covers every Kita of the owner, and nobody else’s', async () => {
    const { organizationId, owner } = await kitaIn('paused')
    const second = await newTestKita()
    kitas.push(second)
    await addTestMember(second, owner.id)
    // An admin of the paused Kita owns one of their own, which is paid for
    const other = await kitaIn('active')
    await addTestMember(organizationId, other.owner.id, 'admin')

    expect(await isKitaPaused(organizationId, now)).toBe(true)
    expect(await isKitaPaused(second, now)).toBe(true)
    expect(await isKitaPaused(other.organizationId, now)).toBe(false)
  })

  test('a Kita without an owner has full access', async () => {
    const organizationId = await newTestKita()
    kitas.push(organizationId)
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(organizationId, admin.id, 'admin')

    expect(await isKitaPaused(organizationId, now)).toBe(false)
    expect(await isKitaPaused('gibt-es-nicht', now)).toBe(false)
  })

  // An owner the hourly run has not reached yet
  test('a Kita whose owner has no subscription has full access, however long', async () => {
    const { organizationId } = await kitaIn()
    expect(await isKitaPaused(organizationId, now)).toBe(false)
    expect(await isKitaPaused(organizationId, addDays(now, 400))).toBe(false)
  })

  describe('without HOSTED', () => {
    beforeEach(() => {
      instanceMode.hosted = false
    })

    test('every Kita has full access, whatever a subscription says', async () => {
      const { organizationId } = await kitaIn('deletable')
      const { kitaToken, link } = await newTestBoard(organizationId)
      expect(await isKitaPaused(organizationId, now)).toBe(false)
      expect(await findPublicBoard(link, now)).toMatchObject({ paused: false })
      expect(await findLinkedBoard(link, now)).toMatchObject({
        paused: false,
      })
      expect(await findPublicKita(kitaToken, now)).toMatchObject({
        paused: false,
      })
      expect(await manifestStatus(kitaToken)).toBe(200)
    })
  })
})

// A subscription is created with the account's first Kita and by the
// server's hourly run, nowhere else
describe('asking never writes', () => {
  async function askEverything() {
    const { organizationId, owner } = await kitaIn()
    const { kitaToken, link } = await newTestBoard(organizationId)
    expect(await isKitaPaused(organizationId, now)).toBe(false)
    expect(await findPublicBoard(link, now)).toMatchObject({ paused: false })
    expect(await findLinkedBoard(link, now)).toMatchObject({ paused: false })
    expect(await findKita(kitaToken, now)).toMatchObject({ paused: false })
    expect(await noticeFor(organizationId, owner.id, now)).toBeNull()
    expect(await manifestStatus(kitaToken)).toBe(200)
    await hostedKitaCreation(owner.id, now)
    return subscriptionOf(owner.id)
  }

  test('no read starts the trial of an owner who has no subscription', async () => {
    expect(await askEverything()).toBeUndefined()
  })

  test('nor does one on an instance that is not hosted', async () => {
    instanceMode.hosted = false
    expect(await askEverything()).toBeUndefined()
  })
})

describe('ensureSubscription', () => {
  test('starts the trial once, however often and however late it is asked', async () => {
    const { owner } = await kitaIn()
    await Promise.all(
      Array.from({ length: 6 }, () =>
        ensureSubscription(testDb, owner.id, now, 30),
      ),
    )
    await ensureSubscription(testDb, owner.id, addDays(now, 10), 30)
    const rows = await testDb
      .select()
      .from(hostedSubscription)
      .where(eq(hostedSubscription.userId, owner.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      trialEndsAt: addBerlinDays(now, 30),
      paidUntil: null,
      complimentary: false,
      reminderStage: 0,
      createdAt: now,
    })
  })

  // Days of the calendar, like every other deadline of a subscription: 30
  // times 24 hours would end this one an hour early
  test('the trial ends at the time of day it began, also when the clocks change in between', async () => {
    const { owner } = await kitaIn()
    // Noon in Berlin, summer time; the clocks go back on 25 October
    const started = new Date('2026-10-10T10:00:00.000Z')
    await ensureSubscription(testDb, owner.id, started, 30)
    expect((await subscriptionOf(owner.id))?.trialEndsAt).toEqual(
      new Date('2026-11-09T11:00:00.000Z'),
    )
  })
})

// How the Kitas that were there before HOSTED was switched on come to their
// subscription (the server's start-up and hourly run). It looks at every
// owner in the database, so each test runs it in a transaction that is rolled
// back: the accounts of other tests and of the dev server stay as they were.
describe('startMissingSubscriptions', () => {
  // What the run writes to the log is the operator's business
  let info: ReturnType<typeof spyOn>

  beforeEach(() => {
    info = spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    info.mockRestore()
  })

  test('starts the trial of every owner who has no subscription', async () => {
    const fresh = await kitaIn()
    const lapsed = await kitaIn('paused')
    const before = await subscriptionOf(lapsed.owner.id)
    // Invited to a Kita, and an account without any: neither owns one
    const admin = await newTestUser()
    const bystander = await newTestUser()
    users.push(admin.id, bystander.id)
    await addTestMember(fresh.organizationId, admin.id, 'admin')

    const after = await rolledBack(async (tx) => {
      await startMissingSubscriptions(now, tx)
      return {
        fresh: await findSubscription(tx, fresh.owner.id),
        lapsed: await findSubscription(tx, lapsed.owner.id),
        admin: await findSubscription(tx, admin.id),
        bystander: await findSubscription(tx, bystander.id),
      }
    })
    expect(after.fresh).toMatchObject({
      trialEndsAt: addBerlinDays(now, 30),
      paidUntil: null,
      complimentary: false,
      reminderStage: 0,
      createdAt: now,
    })
    expect(after.lapsed).toEqual(before)
    expect(after.admin).toBeUndefined()
    expect(after.bystander).toBeUndefined()
    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0]?.[0])).toStartWith('[hosted] Abo-Einträge')
  })

  test('uses the configured length of the trial', async () => {
    hostedPricing.trialDays = 7
    const { owner } = await kitaIn()
    const row = await rolledBack(async (tx) => {
      await startMissingSubscriptions(now, tx)
      return findSubscription(tx, owner.id)
    })
    expect(row?.trialEndsAt).toEqual(addBerlinDays(now, 7))
  })

  test('run again, it starts no trial over', async () => {
    const { organizationId, owner } = await kitaIn()
    // The owner of two Kitas still has one subscription
    const second = await newTestKita()
    kitas.push(second)
    await addTestMember(second, owner.id)

    const rows = await rolledBack(async (tx) => {
      await startMissingSubscriptions(now, tx)
      await startMissingSubscriptions(addDays(now, 10), tx)
      return tx
        .select()
        .from(hostedSubscription)
        .where(eq(hostedSubscription.userId, owner.id))
    })
    expect(rows.map((row) => row.trialEndsAt)).toEqual([addBerlinDays(now, 30)])
    // Nothing of it is left behind by the test
    expect(await subscriptionOf(owner.id)).toBeUndefined()
    expect(await isKitaPaused(organizationId, addDays(now, 400))).toBe(false)
  })

  test('does nothing on an instance that is not hosted', async () => {
    instanceMode.hosted = false
    const { owner } = await kitaIn()
    const row = await rolledBack(async (tx) => {
      await startMissingSubscriptions(now, tx)
      return findSubscription(tx, owner.id)
    })
    expect(row).toBeUndefined()
  })
})

describe('hostedKitaCreation', () => {
  test('an account without a Kita may create one, and gets no subscription for asking', async () => {
    const account = await newTestUser()
    users.push(account.id)
    expect(await hostedKitaCreation(account.id, now)).toEqual({
      refusal: undefined,
      termsRequired: true,
    })
    expect(await subscriptionOf(account.id)).toBeUndefined()
  })

  test('decides by the state of the subscription', async () => {
    const verdicts: Record<string, string | undefined> = {}
    for (const state of STATES) {
      const { owner } = await kitaIn(state)
      verdicts[state] = (await hostedKitaCreation(owner.id, now)).refusal
    }
    expect(verdicts).toEqual({
      trial: 'HOSTED_TRIAL_ONE_KITA',
      active: undefined,
      grace: 'HOSTED_SUBSCRIPTION_INACTIVE',
      paused: 'HOSTED_SUBSCRIPTION_INACTIVE',
      deletable: 'HOSTED_SUBSCRIPTION_INACTIVE',
    })
  })

  // An owner from before HOSTED, until the hourly run has started the trial
  test('an owner without a subscription is held to the one Kita of a trial', async () => {
    const { owner } = await kitaIn()
    expect(await hostedKitaCreation(owner.id, now)).toEqual({
      refusal: 'HOSTED_TRIAL_ONE_KITA',
      termsRequired: false,
    })
    expect(await subscriptionOf(owner.id)).toBeUndefined()
  })

  test('Kitas somebody was invited to do not count', async () => {
    const host = await kitaIn('active')
    const guest = await newTestUser()
    users.push(guest.id)
    await addTestMember(host.organizationId, guest.id, 'admin')
    expect(await hostedKitaCreation(guest.id, now)).toEqual({
      refusal: undefined,
      termsRequired: true,
    })
    expect(await subscriptionOf(guest.id)).toBeUndefined()
  })
})

// What the form for a new Kita asks before it renders
// (src/pages/admin/organizations/new.astro)
describe('the form for a new Kita', () => {
  test('sends an account whose subscription ran out to the subscription page', async () => {
    const redirects: Record<string, string | undefined> = {}
    for (const state of STATES) {
      const { owner } = await kitaIn(state)
      redirects[state] = (await kitaCreationForm(owner.id, now)).redirect
    }
    expect(redirects).toEqual({
      // The form says why a second Kita has to wait
      trial: undefined,
      active: undefined,
      grace: '/admin/abo',
      paused: '/admin/abo',
      deletable: '/admin/abo',
    })
  })

  // No Kita left, and none to be had before the subscription is paid
  test('also once the Kitas were deleted', async () => {
    const account = await newTestUser()
    users.push(account.id)
    await setTestSubscription(account.id, 'deletable', now)
    expect(await kitaCreationForm(account.id, now)).toMatchObject({
      redirect: '/admin/abo',
    })
  })

  test('renders for an account without a Kita, and asks it to agree to the terms', async () => {
    const account = await newTestUser()
    users.push(account.id)
    const asks = { redirect: undefined, termsRequired: true }
    expect(await kitaCreationForm(account.id, now)).toEqual(asks)
    // Invited somewhere: still no Kita of its own
    const host = await kitaIn('active')
    await addTestMember(host.organizationId, account.id, 'admin')
    expect(await kitaCreationForm(account.id, now)).toEqual(asks)
    expect(await kitaCreationForm(host.owner.id, now)).toEqual({
      redirect: undefined,
      termsRequired: false,
    })
  })

  test('without HOSTED nobody is sent away, and nobody is asked', async () => {
    instanceMode.hosted = false
    const { owner } = await kitaIn('deletable')
    const account = await newTestUser()
    users.push(account.id)
    for (const { id } of [owner, account]) {
      expect(await kitaCreationForm(id, now)).toEqual({ termsRequired: false })
    }
  })
})

describe('subscriptionNotice', () => {
  test('counts the days of the trial for the owner', async () => {
    const { organizationId, owner } = await kitaIn()
    // The trial ends 30 days from now, at noon on 3 June in Berlin
    await ensureSubscription(testDb, owner.id, now, 30)
    expect(await noticeFor(organizationId, owner.id, now)).toEqual({
      state: 'trial',
      isOwner: true,
      lastDay: '3. Juni 2026',
      daysLeft: 30,
    })
    expect(
      await noticeFor(organizationId, owner.id, addDays(now, 29)),
    ).toMatchObject({ state: 'trial', daysLeft: 1 })
    expect(
      await noticeFor(
        organizationId,
        owner.id,
        new Date('2026-06-03T06:00:00.000Z'),
      ),
    ).toMatchObject({ state: 'trial', daysLeft: 0 })
  })

  test('says when a trial ran out and when the boards are paused', async () => {
    const { organizationId, owner } = await kitaIn('grace')
    const expiredAt = addDays(now, -5)
    expect(await noticeFor(organizationId, owner.id, now)).toEqual({
      state: 'grace',
      isOwner: true,
      ended: 'trial',
      lastDay: longDate(expiredAt),
      pausesOn: longDate(addDays(expiredAt, 14)),
    })
  })

  // Paid up to and including 30 April: midnight after it is already 1 May
  test('names the last day a paid period covered', async () => {
    const { organizationId, owner } = await kitaIn()
    await testDb.insert(hostedSubscription).values({
      userId: owner.id,
      trialEndsAt: new Date('2025-05-01T10:00:00.000Z'),
      paidUntil: new Date('2026-04-30T22:00:00.000Z'),
    })
    expect(await noticeFor(organizationId, owner.id, now)).toEqual({
      state: 'grace',
      isOwner: true,
      ended: 'subscription',
      lastDay: '30. April 2026',
      pausesOn: '15. Mai 2026',
    })
  })

  // Paid up to 1 April, while the trial ran until 20 April: the trial counts
  test('names the trial when it outlasted a paid period', async () => {
    const { organizationId, owner } = await kitaIn()
    await testDb.insert(hostedSubscription).values({
      userId: owner.id,
      trialEndsAt: new Date('2026-04-20T22:00:00.000Z'),
      paidUntil: new Date('2026-04-01T22:00:00.000Z'),
    })
    expect(await noticeFor(organizationId, owner.id, now)).toEqual({
      state: 'grace',
      isOwner: true,
      ended: 'trial',
      lastDay: '20. April 2026',
      pausesOn: '5. Mai 2026',
    })
  })

  test('says paused, also once the Kita is due for deletion', async () => {
    for (const state of ['paused', 'deletable'] as const) {
      const { organizationId, owner } = await kitaIn(state)
      expect(await noticeFor(organizationId, owner.id, now)).toEqual({
        state: 'paused',
        isOwner: true,
      })
    }
  })

  test('tells an invited admin apart from the owner', async () => {
    const { organizationId } = await kitaIn('paused')
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(organizationId, admin.id, 'admin')
    expect(await noticeFor(organizationId, admin.id, now)).toEqual({
      state: 'paused',
      isOwner: false,
    })
  })

  // An owner the hourly run has not reached yet
  test('has nothing to say while the owner has no subscription', async () => {
    const { organizationId, owner } = await kitaIn()
    expect(await noticeFor(organizationId, owner.id, now)).toBeNull()
  })

  test('has nothing to say about an active subscription', async () => {
    const { organizationId, owner } = await kitaIn('active')
    expect(await noticeFor(organizationId, owner.id, now)).toBeNull()
  })

  test('has nothing to say on an instance that is not hosted', async () => {
    const { organizationId, owner } = await kitaIn('paused')
    instanceMode.hosted = false
    expect(await noticeFor(organizationId, owner.id, now)).toBeNull()
  })
})

describe('a board of a paused Kita', () => {
  let paused: Awaited<ReturnType<typeof kitaIn>>
  let grace: Awaited<ReturnType<typeof kitaIn>>

  beforeAll(async () => {
    paused = await kitaIn('paused')
    grace = await kitaIn('grace')
  })

  // Who answers for the boards is still said: the notes are kept
  const responsible = { kitaName: 'Test-Kita', contact: undefined }

  test('the page gets the two names, who answers for it and no notes', async () => {
    const { id, link } = await newTestBoard(paused.organizationId, {
      name: 'Fundkiste',
    })
    await insertTestNote(id, { createdAt: now })
    expect(await findPublicBoard(link, now)).toEqual({
      paused: true,
      board: { name: 'Fundkiste', kitaName: 'Test-Kita' },
      responsible,
    })
  })

  test('the board page says so, for a board it has and one it has not', async () => {
    const { link } = await newTestBoard(paused.organizationId, {
      name: 'Fundkiste',
    })
    expect(await findBoardPage(link, now)).toEqual({
      kind: 'paused-board',
      paused: true,
      board: { name: 'Fundkiste', kitaName: 'Test-Kita' },
      responsible,
    })
    expect(
      await findBoardPage({ ...link, boardId: 'gibt-es-nicht' }, now),
    ).toEqual({
      kind: 'paused-kita',
      kita: { name: 'Test-Kita' },
      responsible,
    })
  })

  test('the Kita page gets the name and no boards', async () => {
    const { kitaToken } = await newTestBoard(paused.organizationId)
    expect(await findPublicKita(kitaToken, now)).toEqual({
      paused: true,
      kita: { name: 'Test-Kita' },
      responsible,
    })
  })

  test('in the grace period the page is the board as ever', async () => {
    const { id, kitaToken, link } = await newTestBoard(grace.organizationId)
    await insertTestNote(id, { createdAt: now })
    const found = await findPublicBoard(link, now)
    expect(found).toMatchObject({
      paused: false,
      hasMore: false,
      board: { id, kitaToken, name: 'Igelgruppe', kitaName: 'Test-Kita' },
    })
    expect(found && !found.paused && found.notes).toHaveLength(1)
    expect(await findPublicKita(kitaToken, now)).toMatchObject({
      paused: false,
      boards: [{ id, noteCount: 1 }],
    })
  })

  test('the link still leads to the board, which says that it is paused', async () => {
    const { id, link } = await newTestBoard(paused.organizationId)
    expect(await findLinkedBoard(link, now)).toMatchObject({
      id,
      paused: true,
    })
    const open = await newTestBoard(grace.organizationId)
    expect(await findLinkedBoard(open.link, now)).toMatchObject({
      id: open.id,
      paused: false,
    })
  })

  // Nothing to install: the page links to no manifest either. The route
  // reads the clock itself, so these two are set up against today.
  test('there is no manifest', async () => {
    const today = new Date()
    const pausedBoard = await newTestBoard(
      (await kitaIn('paused', today)).organizationId,
    )
    const graceBoard = await newTestBoard(
      (await kitaIn('grace', today)).organizationId,
    )
    expect(await manifestStatus(pausedBoard.kitaToken)).toBe(404)
    expect(await manifestStatus(graceBoard.kitaToken)).toBe(200)
    expect(await manifestStatus('unbekannt')).toBe(404)
  })
})
