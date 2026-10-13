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

import { board, kitaLink, pushSubscription } from '@/db/schema'
import type { Executor } from '@/db/types'
import {
  deleteBoard,
  renewKitaLink,
  setBoardPushEnabled,
} from '@/lib/board/mutations'
import {
  findOrganizationBoard,
  findPublicBoard,
  listBoards,
  subscriberCount,
} from '@/lib/board/queries'
import { newLinkToken } from '@/lib/board/secrets'
import { addDays } from '@/lib/board/time'
import type { BoardLink } from '@/lib/board/types'
import { HOSTED_PAUSED_VISITOR } from '@/lib/hosted/messages'
import { instanceMode } from '@/lib/instance'
import { PUSH_SUBSCRIPTION_IDLE_DAYS } from '@/lib/limits'
import { pushDispatcher } from '@/lib/push/dispatcher'
import {
  PUSH_BOARD_SUBSCRIPTION_CAP,
  PUSH_SUBSCRIBE_BUDGETS,
} from '@/lib/spam/budgets'
import {
  purgeStaleSubscriptions,
  subscribeToBoard,
  syncSubscriptions,
  unsubscribeFromBoard,
  type SubscriptionInput,
} from '@/lib/push/subscriptions'

import {
  addTestMember,
  insertTestNote,
  newTestBoard,
  newTestKita,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  setTestSubscription,
  subscribersOf,
} from './helpers/fixtures'
import { newBrowser, type Browser } from './helpers/push'
import { resetSpamCounters, testDb } from './helpers/spam-db'

const now = new Date('2026-05-04T10:00:00.000Z')
const SUBSCRIBED = { ok: true } as const
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' } as const
let organizationId: string
let otherOrganizationId: string
let browser: Browser

// A fresh board per test, so counts start at zero
function newBoard(values: Partial<typeof board.$inferInsert> = {}) {
  return newTestBoard(organizationId, values)
}

const endpointFor = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/${name}`

function subscription(link: BoardLink, name: string): SubscriptionInput {
  return {
    ...link,
    endpoint: endpointFor(name),
    keys: { p256dh: browser.p256dh, auth: browser.auth },
  }
}

// The page's sync of the browser `name` on the Kita behind `kitaToken`
function sync(kitaToken: string, name: string, client = 'ip4:198.51.100.40') {
  return syncSubscriptions(
    {
      kitaToken,
      endpoint: endpointFor(name),
      keys: { p256dh: browser.p256dh, auth: browser.auth },
    },
    client,
    { now },
  )
}

// What the board page hands the bell: the public key, or null without one
async function pagePush(link: BoardLink) {
  const found = await findPublicBoard(link, now)
  return found && !found.paused ? found.board.pushPublicKey : undefined
}

async function currentKitaToken(id: string) {
  const [row] = await testDb
    .select({ token: kitaLink.token })
    .from(kitaLink)
    .where(eq(kitaLink.organizationId, id))
  return row?.token
}

beforeAll(async () => {
  browser = await newBrowser()
  organizationId = await newTestKita()
  otherOrganizationId = await newTestKita()
})

beforeEach(resetSpamCounters)

afterAll(() => removeTestKitas(organizationId, otherOrganizationId))

describe('subscribeToBoard', () => {
  test('stores a subscription once, however often the bell is tapped', async () => {
    const { id, link } = await newBoard()
    const client = 'ip4:198.51.100.1'
    for (let i = 0; i < 3; i++) {
      expect(
        await subscribeToBoard(subscription(link, 'a'), client, { now }),
      ).toEqual(SUBSCRIBED)
    }
    const rows = await subscribersOf(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      endpoint: endpointFor('a'),
      p256dh: browser.p256dh,
      failureCount: 0,
      lastSuccessAt: null,
    })

    // New keys for the same endpoint replace the old ones
    const renewed = await newBrowser()
    await subscribeToBoard(
      {
        ...subscription(link, 'a'),
        keys: { p256dh: renewed.p256dh, auth: renewed.auth },
      },
      client,
      { now },
    )
    const [row] = await subscribersOf(id)
    expect(row?.p256dh).toBe(renewed.p256dh)
    expect(await subscriberCount(id)).toBe(1)
  })

  test('tapping the bell again counts as a visit and refreshes the keys', async () => {
    const { id, link } = await newBoard()
    const client = 'ip4:198.51.100.12'
    await subscribeToBoard(subscription(link, 'again'), client, { now })
    const later = addDays(now, 3)
    const renewed = await newBrowser()
    expect(
      await subscribeToBoard(
        {
          ...subscription(link, 'again'),
          keys: { p256dh: renewed.p256dh, auth: renewed.auth },
        },
        client,
        { now: later },
      ),
    ).toEqual(SUBSCRIBED)
    const [row] = await subscribersOf(id)
    expect(row).toMatchObject({
      p256dh: renewed.p256dh,
      auth: renewed.auth,
      createdAt: now,
      lastVisitAt: later,
    })
  })

  test('one endpoint follows several boards of the Kita', async () => {
    const first = await newBoard()
    const second = await newBoard()
    const client = 'ip4:198.51.100.2'
    await subscribeToBoard(subscription(first.link, 'shared'), client, { now })
    await subscribeToBoard(subscription(second.link, 'shared'), client, {
      now,
    })
    expect(await subscriberCount(first.id)).toBe(1)
    expect(await subscriberCount(second.id)).toBe(1)

    // Switching one off leaves the other alone
    const off = { ...first.link, endpoint: endpointFor('shared') }
    expect(await unsubscribeFromBoard(off, client, { now })).toEqual({
      ok: true,
      unseen: 0,
      remaining: true,
    })
    expect(await subscriberCount(first.id)).toBe(0)
    expect(await subscriberCount(second.id)).toBe(1)
    // … and doing it again is no error
    expect(await unsubscribeFromBoard(off, client, { now })).toEqual({
      ok: true,
      unseen: 0,
      remaining: true,
    })
  })

  test('tells the browser when its last bell anywhere went off', async () => {
    const first = await newBoard()
    const elsewhere = await newTestBoard(otherOrganizationId)
    const client = 'ip4:198.51.100.4'
    // An endpoint no other test uses
    const name = `last-${crypto.randomUUID()}`
    for (const { link } of [first, elsewhere]) {
      await subscribeToBoard(subscription(link, name), client, { now })
    }
    const off = (link: BoardLink) => ({ ...link, endpoint: endpointFor(name) })
    // Another Kita's board still has it: the browser keeps its subscription
    expect(
      await unsubscribeFromBoard(off(first.link), client, { now }),
    ).toEqual({ ok: true, unseen: 0, remaining: true })
    // That was the last one
    expect(
      await unsubscribeFromBoard(off(elsewhere.link), client, { now }),
    ).toEqual({ ok: true, unseen: 0, remaining: false })
  })

  test('only takes endpoints of known push services and valid keys', async () => {
    const { id, link } = await newBoard()
    const client = 'ip4:198.51.100.3'
    for (const endpoint of [
      'https://evil.example/fcm/send/a',
      'http://fcm.googleapis.com/fcm/send/a',
    ]) {
      expect(
        await subscribeToBoard(
          { ...subscription(link, 'a'), endpoint },
          client,
          {
            now,
          },
        ),
      ).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    }
    expect(
      await subscribeToBoard(
        {
          ...subscription(link, 'a'),
          keys: { p256dh: browser.p256dh, auth: 'kurz' },
        },
        client,
        { now },
      ),
    ).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(await subscriberCount(id)).toBe(0)
  })

  test('answers 404 for unknown links, switched-off boards and without VAPID', async () => {
    const client = 'ip4:198.51.100.4'
    const off = await newBoard({ pushEnabled: false })
    const on = await newBoard()
    const elsewhere = await newTestBoard(otherOrganizationId)
    for (const [link, configured] of [
      // Malformed (never reaches the database) and well-formed but unknown
      [{ ...on.link, kitaToken: 'gibt-es-nicht' }, true],
      [{ ...on.link, kitaToken: newLinkToken() }, true],
      // A board of another Kita under this Kita's link
      [{ ...on.link, boardId: elsewhere.id }, true],
      [{ ...on.link, boardId: 'gibt-es-nicht' }, true],
      [off.link, true],
      [on.link, false],
    ] as const) {
      expect(
        await subscribeToBoard(subscription(link, 'a'), client, {
          now,
          configured,
        }),
      ).toEqual(NOT_FOUND)
    }
    expect(await subscriberCount(elsewhere.id)).toBe(0)
    expect(
      await unsubscribeFromBoard(
        { ...on.link, endpoint: endpointFor('a') },
        client,
        { now, configured: false },
      ),
    ).toEqual(NOT_FOUND)
    expect(
      await unsubscribeFromBoard(
        { ...on.link, kitaToken: 'gibt-es-nicht', endpoint: endpointFor('a') },
        client,
        { now },
      ),
    ).toEqual(NOT_FOUND)
  })

  test('never unsubscribes a board of another Kita', async () => {
    const elsewhere = await newTestBoard(otherOrganizationId)
    const client = 'ip4:198.51.100.11'
    await subscribeToBoard(subscription(elsewhere.link, 'a'), client, { now })
    const { kitaToken } = await newBoard()
    expect(
      await unsubscribeFromBoard(
        { kitaToken, boardId: elsewhere.id, endpoint: endpointFor('a') },
        client,
        { now },
      ),
    ).toEqual(NOT_FOUND)
    expect(await subscriberCount(elsewhere.id)).toBe(1)
  })

  test('limits new subscriptions per network, but not refreshes', async () => {
    const { link } = await newBoard()
    const client = 'ip4:198.51.100.5'
    const max = PUSH_SUBSCRIBE_BUDGETS[0]!.max
    // A parents' evening: a few dozen phones with several boards each, ten
    // seconds apart — within the hour, and within what every request of a
    // network may (PUSH_REQUEST_BUDGETS)
    expect(max).toBeGreaterThanOrEqual(150)
    const at = (i: number) => new Date(now.getTime() + i * 10_000)
    for (let i = 0; i < max; i++) {
      expect(
        await subscribeToBoard(subscription(link, `phone-${i}`), client, {
          now: at(i),
        }),
      ).toEqual(SUBSCRIBED)
    }
    const later = { now: at(max) }
    const refused = await subscribeToBoard(
      subscription(link, 'one-too-many'),
      client,
      later,
    )
    expect(refused).toMatchObject({ ok: false, code: 'TOO_MANY_REQUESTS' })
    expect(refused.ok || refused.message).toContain('Geräte')

    // The phones already subscribed keep refreshing
    expect(
      await subscribeToBoard(subscription(link, 'phone-0'), client, later),
    ).toEqual(SUBSCRIBED)
    // … and another network is not affected
    expect(
      await subscribeToBoard(
        subscription(link, 'elsewhere'),
        'ip4:198.51.100.6',
        later,
      ),
    ).toEqual(SUBSCRIBED)
  })

  test('stops at the cap of a board', async () => {
    const { id, link } = await newBoard()
    await testDb.insert(pushSubscription).values(
      Array.from({ length: PUSH_BOARD_SUBSCRIPTION_CAP - 1 }, (_, index) => ({
        boardId: id,
        endpoint: endpointFor(`filler-${index}`),
        p256dh: browser.p256dh,
        auth: browser.auth,
      })),
    )
    expect(
      await subscribeToBoard(subscription(link, 'last'), 'ip4:198.51.100.7', {
        now,
      }),
    ).toEqual(SUBSCRIBED)
    expect(
      await subscribeToBoard(subscription(link, 'over'), 'ip4:198.51.100.8', {
        now,
      }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' })
    // A phone already on the list still refreshes
    expect(
      await subscribeToBoard(subscription(link, 'last'), 'ip4:198.51.100.8', {
        now,
      }),
    ).toEqual(SUBSCRIBED)
    expect(await subscriberCount(id)).toBe(PUSH_BOARD_SUBSCRIPTION_CAP)
  })
})

describe('syncing on page load', () => {
  let kitaId: string

  // A Kita of its own, so the boards the sync finds are only this test's
  beforeEach(async () => {
    kitaId = await newTestKita()
  })

  afterEach(() => removeTestKitas(kitaId))

  test('answers the boards this browser follows and refreshes their keys', async () => {
    const followed = await newTestBoard(kitaId)
    const second = await newTestBoard(kitaId)
    const unfollowed = await newTestBoard(kitaId)
    const client = 'ip4:198.51.100.20'
    for (const { link } of [followed, second]) {
      await subscribeToBoard(subscription(link, 'a'), client, { now })
    }
    // Someone else's subscription is no business of this browser
    await subscribeToBoard(subscription(unfollowed.link, 'b'), client, { now })

    const rotated = await newBrowser()
    const answer = await syncSubscriptions(
      {
        kitaToken: followed.kitaToken,
        endpoint: endpointFor('a'),
        keys: { p256dh: rotated.p256dh, auth: rotated.auth },
      },
      client,
      { now },
    )
    expect(answer.ok).toBe(true)
    expect(answer.ok && answer.boardIds.toSorted()).toEqual(
      [followed.id, second.id].toSorted(),
    )
    for (const id of [followed.id, second.id]) {
      const [row] = await subscribersOf(id)
      expect(row?.p256dh).toBe(rotated.p256dh)
    }
    const [other] = await subscribersOf(unfollowed.id)
    expect(other?.p256dh).toBe(browser.p256dh)
  })

  test('never adds one, and spends nothing of the budget for new ones', async () => {
    const { id, kitaToken, link } = await newTestBoard(kitaId)
    const client = 'ip4:198.51.100.21'
    for (let i = 0; i <= 3; i++) {
      expect(await sync(kitaToken, `gone-${i}`, client)).toEqual({
        ok: true,
        boardIds: [],
        unseen: 0,
        remaining: false,
      })
    }
    expect(await subscriberCount(id)).toBe(0)
    // The network's budget for new subscriptions is untouched
    expect(
      await subscribeToBoard(subscription(link, 'tapped'), client, { now }),
    ).toEqual(SUBSCRIBED)
  })

  test('leaves out boards that stopped taking subscriptions, and other Kitas', async () => {
    const off = await newTestBoard(kitaId)
    const elsewhere = await newTestBoard(otherOrganizationId)
    const client = 'ip4:198.51.100.22'
    await subscribeToBoard(subscription(off.link, 'a'), client, { now })
    await subscribeToBoard(subscription(elsewhere.link, 'a'), client, { now })
    // Switched off without dropping the rows, as a racing sync could see it
    await testDb
      .update(board)
      .set({ pushEnabled: false })
      .where(eq(board.id, off.id))
    expect(await sync(off.kitaToken, 'a', client)).toEqual({
      ok: true,
      boardIds: [],
      unseen: 0,
      remaining: true,
    })
  })

  test('tells the browser whether its endpoint still follows any board', async () => {
    const here = await newTestBoard(kitaId)
    const elsewhere = await newTestBoard(otherOrganizationId)
    const client = 'ip4:198.51.100.25'
    // An endpoint no other test uses
    const name = `remaining-${crypto.randomUUID()}`
    await subscribeToBoard(subscription(elsewhere.link, name), client, { now })
    // No bell on in this Kita, but another Kita's board still has it
    expect(await sync(here.kitaToken, name, client)).toEqual({
      ok: true,
      boardIds: [],
      unseen: 0,
      remaining: true,
    })
    // Dropped there as well (switched off, renewed, purged …): nothing left
    await setBoardPushEnabled(otherOrganizationId, elsewhere.id, false)
    expect(await sync(here.kitaToken, name, client)).toEqual({
      ok: true,
      boardIds: [],
      unseen: 0,
      remaining: false,
    })
  })

  test('notes the visit at most once a day', async () => {
    const first = await newTestBoard(kitaId)
    const second = await newTestBoard(kitaId)
    const client = 'ip4:198.51.100.24'
    for (const { link } of [first, second]) {
      await subscribeToBoard(subscription(link, 'a'), client, { now })
    }
    const visits = async () =>
      (await Promise.all([first.id, second.id].map(subscribersOf))).map(
        ([row]) => row?.lastVisitAt,
      )
    const syncAt = (at: Date) =>
      syncSubscriptions(
        {
          kitaToken: first.kitaToken,
          endpoint: endpointFor('a'),
          keys: { p256dh: browser.p256dh, auth: browser.auth },
        },
        client,
        { now: at },
      )
    // Subscribing counts as the first visit
    expect(await visits()).toEqual([now, now])

    // Within the day nothing is written …
    const later = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    await syncAt(new Date(later.getTime() - 1))
    expect(await visits()).toEqual([now, now])
    // … a day on, the next sync notes it on every board it answers for
    await syncAt(new Date(later.getTime() + 1))
    const noted = new Date(later.getTime() + 1)
    expect(await visits()).toEqual([noted, noted])
    await syncAt(new Date(later.getTime() + 60_000))
    expect(await visits()).toEqual([noted, noted])
  })

  test("notes the visit only on the Kita's boards that take subscriptions", async () => {
    const visited = await newTestBoard(kitaId)
    const off = await newTestBoard(kitaId)
    const elsewhere = await newTestBoard(otherOrganizationId)
    const client = 'ip4:198.51.100.26'
    const name = `visit-${crypto.randomUUID()}`
    for (const { link } of [visited, off, elsewhere]) {
      await subscribeToBoard(subscription(link, name), client, { now })
    }
    // Switched off without dropping the rows, as a racing sync could see it
    await testDb
      .update(board)
      .set({ pushEnabled: false })
      .where(eq(board.id, off.id))
    const later = addDays(now, 2)
    await syncSubscriptions(
      {
        kitaToken: visited.kitaToken,
        endpoint: endpointFor(name),
        keys: { p256dh: browser.p256dh, auth: browser.auth },
      },
      client,
      { now: later },
    )
    const visitOf = async (id: string) => (await subscribersOf(id))[0]
    expect((await visitOf(visited.id))?.lastVisitAt).toEqual(later)
    // The same endpoint on a board without notifications and in another
    // Kita: a page of this Kita is no visit there
    expect((await visitOf(off.id))?.lastVisitAt).toEqual(now)
    expect((await visitOf(elsewhere.id))?.lastVisitAt).toEqual(now)
  })

  test('answers 404 for links that lead nowhere and without VAPID', async () => {
    const { kitaToken } = await newTestBoard(kitaId)
    const client = 'ip4:198.51.100.23'
    for (const token of ['gibt-es-nicht', newLinkToken()]) {
      expect(await sync(token, 'a', client)).toEqual(NOT_FOUND)
    }
    expect(
      await syncSubscriptions(
        {
          kitaToken,
          endpoint: endpointFor('a'),
          keys: { p256dh: browser.p256dh, auth: browser.auth },
        },
        client,
        { now, configured: false },
      ),
    ).toEqual(NOT_FOUND)
  })
})

describe('racing a revocation', () => {
  const client = 'ip4:198.51.100.30'
  let kitaId: string

  beforeEach(async () => {
    kitaId = await newTestKita()
  })

  afterEach(() => removeTestKitas(kitaId))

  test('the old link adds nothing once the new one is out', async () => {
    const { id, link } = await newTestBoard(kitaId)
    // The visitor's page was loaded with the old link …
    expect(await pagePush(link)).toBeTruthy()
    // … the admin renews it …
    await renewKitaLink(kitaId)
    // … and only then does the bell's request arrive
    expect(
      await subscribeToBoard(subscription(link, 'a'), client, { now }),
    ).toEqual(NOT_FOUND)
    expect(await sync(link.kitaToken, 'a', client)).toEqual(NOT_FOUND)
    expect(await subscriberCount(id)).toBe(0)
  })

  // The revocation holds the rows while the subscription comes in: the
  // subscription waits, then finds the link gone instead of slipping in after
  // the delete
  async function whileRevoking(
    revoke: (tx: Executor, boardId: string) => Promise<unknown>,
    subscribed = false,
  ) {
    const { id, link } = await newTestBoard(kitaId)
    if (subscribed) {
      await subscribeToBoard(subscription(link, 'a'), client, { now })
    }
    let pending: ReturnType<typeof subscribeToBoard> | undefined
    await testDb.transaction(async (tx) => {
      await revoke(tx, id)
      await tx.delete(pushSubscription).where(eq(pushSubscription.boardId, id))
      pending = subscribeToBoard(subscription(link, 'new'), client, { now })
      await Bun.sleep(150)
    })
    expect(await pending).toEqual(NOT_FOUND)
    expect(await subscriberCount(id)).toBe(0)
  }

  // What renewKitaLink writes, held open
  const renewLink = (tx: Executor) =>
    tx
      .update(kitaLink)
      .set({ token: newLinkToken() })
      .where(eq(kitaLink.organizationId, kitaId))
  const switchOff = (tx: Executor, id: string) =>
    tx.update(board).set({ pushEnabled: false }).where(eq(board.id, id))

  test('a new subscription loses against a renewed Kita link', async () => {
    await whileRevoking(renewLink)
  })

  test('a new subscription loses against notifications switched off', async () => {
    await whileRevoking(switchOff, true)
  })

  // The other way round: the subscription holds the board and the Kita link,
  // the renewal waits for it and then deletes it with the rest
  test('a subscription that came first is deleted by the renewal', async () => {
    const { id, link } = await newTestBoard(kitaId)
    let renewal: Promise<string[]> | undefined
    await testDb.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: kitaLink.organizationId })
        .from(kitaLink)
        .where(eq(kitaLink.organizationId, kitaId))
        .for('key share')
      expect(locked).toBeTruthy()
      await tx.insert(pushSubscription).values({
        boardId: id,
        endpoint: endpointFor('first'),
        p256dh: browser.p256dh,
        auth: browser.auth,
      })
      renewal = renewKitaLink(kitaId)
      await Bun.sleep(150)
    })
    expect(await renewal).toEqual([id])
    expect(await subscriberCount(id)).toBe(0)
    expect(await currentKitaToken(kitaId)).not.toBe(link.kitaToken)
  })
})

describe('renewing the Kita link', () => {
  let kitaId: string

  beforeEach(async () => {
    kitaId = await newTestKita()
  })

  afterEach(() => removeTestKitas(kitaId))

  test('drops the subscriptions of every board of the Kita, and only those', async () => {
    const client = 'ip4:198.51.100.31'
    const first = await newTestBoard(kitaId)
    const second = await newTestBoard(kitaId)
    const quiet = await newTestBoard(kitaId)
    const elsewhere = await newTestBoard(otherOrganizationId)
    for (const { link } of [first, second, elsewhere]) {
      await subscribeToBoard(subscription(link, 'a'), client, { now })
    }
    const noteId = await insertTestNote(first.id)

    const kitaBoards = [first.id, second.id, quiet.id].toSorted()
    const renewed = await renewKitaLink(kitaId)
    expect(renewed.toSorted()).toEqual(kitaBoards)
    expect(await subscriberCount(first.id)).toBe(0)
    expect(await subscriberCount(second.id)).toBe(0)
    expect(await subscriberCount(quiet.id)).toBe(0)
    expect(await subscriberCount(elsewhere.id)).toBe(1)

    // Every board is out of reach under the old link, and back under the new
    const token = await currentKitaToken(kitaId)
    expect(token).toMatch(/^[\w-]{22}$/)
    expect(token).not.toBe(first.kitaToken)
    expect(await findPublicBoard(first.link, now)).toBeUndefined()
    const found = await findPublicBoard(
      { kitaToken: token!, boardId: first.id },
      now,
    )
    // The notes stay
    expect(found?.paused === false && found.notes.map((n) => n.id)).toEqual([
      noteId,
    ])
  })

  // A board without subscribers may still have notes waiting to go out:
  // whoever subscribes with the new link during the wait must not get them
  test('drops what every board of the Kita still had to send', async () => {
    const quiet = await newTestBoard(kitaId)
    const elsewhere = await newTestBoard(otherOrganizationId)
    const cancel = spyOn(pushDispatcher, 'cancel')
    try {
      await renewKitaLink(kitaId)
      expect(cancel.mock.calls).toEqual([[quiet.id]])
      expect(cancel).not.toHaveBeenCalledWith(elsewhere.id)
    } finally {
      cancel.mockRestore()
    }
  })

  test('makes the link of a Kita that had none', async () => {
    await testDb.delete(kitaLink).where(eq(kitaLink.organizationId, kitaId))
    expect(await renewKitaLink(kitaId)).toEqual([])
    expect(await currentKitaToken(kitaId)).toMatch(/^[\w-]{22}$/)
  })
})

describe('what else ends subscriptions', () => {
  async function subscribedBoard() {
    const created = await newBoard()
    await subscribeToBoard(
      subscription(created.link, 'a'),
      'ip4:198.51.100.9',
      {
        now,
      },
    )
    expect(await subscriberCount(created.id)).toBe(1)
    return created
  }

  test("another Kita's board is out of reach", async () => {
    const target = await subscribedBoard()
    expect(
      await setBoardPushEnabled(otherOrganizationId, target.id, false),
    ).toEqual([])
    expect(await deleteBoard(otherOrganizationId, target.id)).toEqual([])
    expect(await subscriberCount(target.id)).toBe(1)
  })

  test('switching notifications off drops them and hides the bell', async () => {
    const target = await subscribedBoard()
    expect(await pagePush(target.link)).toEqual(expect.any(String))
    expect(
      await setBoardPushEnabled(organizationId, target.id, false),
    ).toHaveLength(1)
    expect(await subscriberCount(target.id)).toBe(0)
    expect(await pagePush(target.link)).toBeNull()
    // Switched on again, nothing comes back by itself
    expect(
      await setBoardPushEnabled(organizationId, target.id, true),
    ).toHaveLength(1)
    expect(await subscriberCount(target.id)).toBe(0)
  })

  test('deleting the board takes them along', async () => {
    const target = await subscribedBoard()
    expect(await deleteBoard(organizationId, target.id)).toHaveLength(1)
    expect(await subscriberCount(target.id)).toBe(0)
  })

  // Rows straight into the table, on a board of their own
  async function insertRows(
    boardId: string,
    rows: ({ name: string } & Partial<typeof pushSubscription.$inferInsert>)[],
  ) {
    await testDb.insert(pushSubscription).values(
      rows.map(({ name, ...row }) => ({
        ...row,
        boardId,
        endpoint: endpointFor(name),
        p256dh: browser.p256dh,
        auth: browser.auth,
      })),
    )
  }

  async function leftAfterPurge(boardId: string) {
    await purgeStaleSubscriptions(now)
    const left = await subscribersOf(boardId)
    return left.map((row) => row.endpoint).toSorted()
  }

  test('housekeeping drops those that fail for a month', async () => {
    const { id } = await newBoard()
    const longAgo = addDays(now, -31)
    await insertRows(id, [
      // Keeps failing, nothing got through for a month: gone
      {
        name: 'dead',
        failureCount: 3,
        createdAt: longAgo,
        lastVisitAt: now,
        lastSuccessAt: null,
      },
      {
        name: 'dead-since',
        failureCount: 5,
        createdAt: longAgo,
        lastVisitAt: now,
        lastSuccessAt: addDays(now, -40),
      },
      // Failing, but reached recently / only just subscribed / rarely failing
      {
        name: 'recent-success',
        failureCount: 3,
        createdAt: longAgo,
        lastSuccessAt: addDays(now, -2),
      },
      {
        name: 'new',
        failureCount: 3,
        createdAt: addDays(now, -3),
        lastSuccessAt: null,
      },
      {
        name: 'fine',
        failureCount: 1,
        createdAt: longAgo,
        lastVisitAt: longAgo,
        lastSuccessAt: null,
      },
    ])
    expect(await leftAfterPurge(id)).toEqual(
      ['fine', 'new', 'recent-success'].map(endpointFor),
    )
  })

  test('housekeeping drops those nothing came of for half a year', async () => {
    const { id } = await newBoard()
    const DAY = 24 * 60 * 60 * 1000
    const idle = PUSH_SUBSCRIPTION_IDLE_DAYS * DAY
    // Just past the bound, and right on it
    const over = new Date(now.getTime() - idle - 1)
    const on = new Date(now.getTime() - idle)
    await insertRows(id, [
      // Never visited since, never delivered to: gone
      { name: 'idle', createdAt: over, lastVisitAt: over },
      // Visited and delivered to, both too long ago: gone
      {
        name: 'idle-since',
        createdAt: addDays(now, -400),
        lastVisitAt: over,
        lastSuccessAt: over,
      },
      // Exactly 180 days is not older than 180 days
      { name: 'on-the-day', createdAt: on, lastVisitAt: on },
      // A page of the Kita opened recently: kept, however quiet the board
      { name: 'visited', createdAt: over, lastVisitAt: addDays(now, -10) },
      // Delivered to recently: kept, even if the page is never opened
      {
        name: 'delivered',
        createdAt: over,
        lastVisitAt: over,
        lastSuccessAt: addDays(now, -10),
      },
    ])
    expect(await leftAfterPurge(id)).toEqual(
      ['delivered', 'on-the-day', 'visited'].map(endpointFor),
    )
  })
})

describe('the admin view', () => {
  test('counts subscribers without multiplying the notes', async () => {
    const { id, link } = await newBoard()
    for (const name of ['a', 'b', 'c']) {
      await subscribeToBoard(subscription(link, name), 'ip4:198.51.100.10', {
        now,
      })
    }
    for (const title of ['Zettel 1', 'Zettel 2']) {
      await insertTestNote(id, { title, createdAt: now })
    }
    const listed = (await listBoards(organizationId, now)).find(
      (row) => row.id === id,
    )
    expect(listed).toMatchObject({ noteCount: 2, subscriberCount: 3 })
    const found = await findOrganizationBoard(organizationId, id, now)
    expect(found?.subscriberCount).toBe(3)
    expect(found?.board.pushEnabled).toBe(true)
  })
})

// The Kita's subscription on the hosted instance (src/lib/hosted/access.ts)
describe('a board of a paused Kita', () => {
  const client = 'ip4:198.51.100.60'
  const PAUSED = {
    ok: false,
    code: 'PAYMENT_REQUIRED',
    message: HOSTED_PAUSED_VISITOR,
  } as const
  let ownerId: string

  beforeAll(async () => {
    const owner = await newTestUser()
    ownerId = owner.id
    await addTestMember(organizationId, ownerId)
  })

  afterEach(() => {
    instanceMode.hosted = false
  })

  afterAll(() => removeTestUsers(ownerId))

  test('takes no new subscription and refreshes none', async () => {
    const { id, link } = await newBoard()
    await subscribeToBoard(subscription(link, 'a'), client, { now })
    await setTestSubscription(ownerId, 'paused', now)
    instanceMode.hosted = true

    expect(
      await subscribeToBoard(subscription(link, 'b'), client, { now }),
    ).toEqual(PAUSED)
    const renewed = await newBrowser()
    expect(
      await syncSubscriptions(
        {
          kitaToken: link.kitaToken,
          endpoint: endpointFor('a'),
          keys: { p256dh: renewed.p256dh, auth: renewed.auth },
        },
        client,
        { now },
      ),
    ).toEqual(PAUSED)
    // What was there stays as it was, for when the Kita is paid for again
    const rows = await subscribersOf(id)
    expect(rows.map((row) => row.endpoint)).toEqual([endpointFor('a')])
    expect(rows[0]?.p256dh).toBe(browser.p256dh)
  })

  test('answers what it always answered before it looks at the subscription', async () => {
    await setTestSubscription(ownerId, 'paused', now)
    instanceMode.hosted = true
    const { link } = await newBoard()
    // Not a push service: turned away as invalid, paused or not
    expect(
      await subscribeToBoard(
        { ...subscription(link, 'a'), endpoint: 'https://evil.example/push' },
        client,
        { now },
      ),
    ).toEqual({ ok: false, code: 'BAD_REQUEST' })
    // A link that leads nowhere stays a 404
    const unknown = { ...link, kitaToken: newLinkToken() }
    expect(
      await subscribeToBoard(subscription(unknown, 'a'), client, { now }),
    ).toEqual(NOT_FOUND)
    expect(await sync(unknown.kitaToken, 'a', client)).toEqual(NOT_FOUND)
  })

  test('lets a browser unsubscribe', async () => {
    const { id, link } = await newBoard()
    await subscribeToBoard(subscription(link, 'a'), client, { now })
    await setTestSubscription(ownerId, 'deletable', now)
    instanceMode.hosted = true

    expect(
      await unsubscribeFromBoard(
        { ...link, endpoint: endpointFor('a') },
        client,
        { now },
      ),
    ).toMatchObject({ ok: true, unseen: 0 })
    expect(await subscribersOf(id)).toEqual([])
  })

  test('subscribes and syncs as ever in the grace period', async () => {
    const { id, link } = await newBoard()
    await setTestSubscription(ownerId, 'grace', now)
    instanceMode.hosted = true
    expect(
      await subscribeToBoard(subscription(link, 'a'), client, { now }),
    ).toEqual(SUBSCRIBED)
    const answer = await sync(link.kitaToken, 'a', client)
    expect(answer.ok && answer.boardIds).toContain(id)
  })

  test('without HOSTED the subscription is not even looked at', async () => {
    const { link } = await newBoard()
    await setTestSubscription(ownerId, 'paused', now)
    expect(
      await subscribeToBoard(subscription(link, 'a'), client, { now }),
    ).toEqual(SUBSCRIBED)
  })
})
