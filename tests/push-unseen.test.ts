import { z } from 'astro/zod'
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
import { and, eq } from 'drizzle-orm'

import { notes } from '@/actions/notes'
import { push } from '@/actions/push'
import { pushSubscription } from '@/db/schema'
import { addDays } from '@/lib/board/time'
import { pushDispatcher } from '@/lib/push/dispatcher'
import {
  syncSubscriptions,
  unsubscribeFromBoard,
} from '@/lib/push/subscriptions'
import { BADGE_MAX, unseenCount, unseenCounts } from '@/lib/push/unseen'

import { visitorContext } from './helpers/actions'
import {
  insertTestNote,
  newTestBoard,
  newTestKita,
  removeTestKitas,
} from './helpers/fixtures'
import { noteDraft } from './helpers/note-draft'
import { newBrowser, type Browser } from './helpers/push'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// The number on the icon of the installed Kita app (src/lib/push/unseen.ts):
// what counts, push.sync (with a board page's board) and push.unsubscribe
// answering it, and a note the browser pins itself. Against the local
// PostgreSQL.

const now = new Date('2026-05-04T10:00:00.000Z')
const minutes = (n: number) => new Date(now.getTime() + n * 60_000)
const client = 'ip4:198.51.100.80'
const kitas: string[] = []
let browser: Browser

const endpointFor = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/unseen-${name}`

async function newKita() {
  const id = await newTestKita()
  kitas.push(id)
  return id
}

// A subscription of the browser `name` to the board, seen up to `seenAt`
async function subscribe(boardId: string, name: string, seenAt = now) {
  await testDb.insert(pushSubscription).values({
    boardId,
    endpoint: endpointFor(name),
    p256dh: browser.p256dh,
    auth: browser.auth,
    createdAt: seenAt,
    seenAt,
  })
}

async function seenAtOf(boardId: string, name: string) {
  const [row] = await testDb
    .select({ seenAt: pushSubscription.seenAt })
    .from(pushSubscription)
    .where(
      and(
        eq(pushSubscription.boardId, boardId),
        eq(pushSubscription.endpoint, endpointFor(name)),
      ),
    )
  return row?.seenAt
}

function noteAt(boardId: string, at: Date, values = {}) {
  return insertTestNote(boardId, { createdAt: at, ...values })
}

// push.sync of the browser `name` at `at`, from a board page when `boardId`
// is set: that page has shown its board up to `until` (by default `at`)
function sync(
  { kitaToken, boardId }: { kitaToken: string; boardId?: string },
  name: string,
  at: Date,
  until = at,
) {
  return syncSubscriptions(
    {
      kitaToken,
      seen: boardId ? { boardId, until } : undefined,
      endpoint: endpointFor(name),
      keys: { p256dh: browser.p256dh, auth: browser.auth },
    },
    client,
    { now: at },
  )
}

beforeAll(async () => {
  browser = await newBrowser()
})

beforeEach(resetSpamCounters)

afterAll(() => removeTestKitas(...kitas))

describe('the unseen count', () => {
  test('counts the notes after seenAt on the boards with a bell, and nothing else', async () => {
    const kita = await newKita()
    const followed = await newTestBoard(kita)
    const second = await newTestBoard(kita)
    const unfollowed = await newTestBoard(kita)
    const otherKita = await newKita()
    const elsewhere = await newTestBoard(otherKita)
    for (const { id } of [followed, second, elsewhere]) {
      await subscribe(id, 'a')
    }

    // Counted: newer than the subscription's seenAt and still hanging
    await noteAt(followed.id, minutes(1))
    await noteAt(followed.id, minutes(2))
    await noteAt(second.id, minutes(3))
    // Not counted: seen already, expired, …
    await noteAt(followed.id, minutes(-1))
    await noteAt(followed.id, minutes(1), { expiresAt: minutes(5) })
    // … on a board without a bell, or on another Kita's board
    await noteAt(unfollowed.id, minutes(1))
    await noteAt(elsewhere.id, minutes(1))

    const later = minutes(10)
    expect(await unseenCount(kita, endpointFor('a'), later)).toBe(3)
    // Another browser has no subscription here
    expect(await unseenCount(kita, endpointFor('b'), later)).toBe(0)
    // The other Kita counts its own board only
    expect(await unseenCount(otherKita, endpointFor('a'), later)).toBe(1)
  })

  test('leaves out boards that stopped taking subscriptions', async () => {
    const kita = await newKita()
    const off = await newTestBoard(kita, { pushEnabled: false })
    // Switched off without dropping the rows, as a racing count could see it
    await subscribe(off.id, 'a')
    await noteAt(off.id, minutes(1))
    expect(await unseenCount(kita, endpointFor('a'), minutes(2))).toBe(0)
  })

  test('answers every endpoint in one go, and stops at 99', async () => {
    const kita = await newKita()
    const { id } = await newTestBoard(kita)
    await subscribe(id, 'early', minutes(-1))
    await subscribe(id, 'late', minutes(BADGE_MAX + 1))
    await testDb.insert(pushSubscription).values({
      boardId: id,
      endpoint: endpointFor('fresh'),
      p256dh: browser.p256dh,
      auth: browser.auth,
      seenAt: minutes(BADGE_MAX + 50),
    })
    for (let i = 0; i < BADGE_MAX + 5; i++) {
      await noteAt(id, minutes(i))
    }
    const counts = await unseenCounts(
      kita,
      ['early', 'late', 'fresh', 'unknown'].map(endpointFor),
      minutes(BADGE_MAX + 60),
    )
    expect(Object.fromEntries(counts)).toEqual({
      [endpointFor('early')]: BADGE_MAX,
      [endpointFor('late')]: 3,
    })
    expect(await unseenCounts(kita, [], now)).toEqual(new Map())
  })
})

describe('push.sync', () => {
  test('answers the number for the icon along with the bells', async () => {
    const kita = await newKita()
    const { id, kitaToken } = await newTestBoard(kita)
    await subscribe(id, 'a')
    await noteAt(id, minutes(1))
    await noteAt(id, minutes(2))
    expect(await sync({ kitaToken }, 'a', minutes(3))).toEqual({
      ok: true,
      boardIds: [id],
      unseen: 2,
      remaining: true,
    })
    // Without a board nothing counts as seen
    expect(await seenAtOf(id, 'a')).toEqual(now)
  })

  test("with a board page's board, marks it seen first and answers what is left", async () => {
    const kita = await newKita()
    const opened = await newTestBoard(kita)
    const other = await newTestBoard(kita)
    for (const { id } of [opened, other]) {
      await subscribe(id, 'a')
      await subscribe(id, 'b')
      await noteAt(id, minutes(1))
    }
    expect(await unseenCount(kita, endpointFor('a'), minutes(5))).toBe(2)
    expect(await sync(opened.link, 'a', minutes(5))).toEqual({
      ok: true,
      boardIds: expect.arrayContaining([opened.id, other.id]),
      unseen: 1,
      remaining: true,
    })
    expect(await seenAtOf(opened.id, 'a')).toEqual(minutes(5))
    // The other board, and the other browser, stay as they were
    expect(await seenAtOf(other.id, 'a')).toEqual(now)
    expect(await seenAtOf(opened.id, 'b')).toEqual(now)
    expect(await unseenCount(kita, endpointFor('b'), minutes(5))).toBe(2)

    // A board without this browser's bell: nothing to mark, still the count
    const quiet = await newTestBoard(kita)
    await noteAt(quiet.id, minutes(1))
    expect(await sync(quiet.link, 'a', minutes(5))).toMatchObject({
      ok: true,
      unseen: 1,
    })
  })

  test('writes nothing when nothing new hangs there', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    await subscribe(id, 'a')
    // Seen already, and expired
    await noteAt(id, minutes(-1))
    await noteAt(id, minutes(1), { expiresAt: minutes(2) })
    expect(await sync(link, 'a', minutes(5))).toMatchObject({ unseen: 0 })
    expect(await seenAtOf(id, 'a')).toEqual(now)
  })

  test('only ever moves seenAt forward', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    await subscribe(id, 'a')
    await noteAt(id, minutes(1))
    await noteAt(id, minutes(3))
    expect(await sync(link, 'a', minutes(5), minutes(4))).toMatchObject({
      unseen: 0,
    })
    expect(await seenAtOf(id, 'a')).toEqual(minutes(4))
    // A newer note, then a delayed sync from a page that showed less
    await noteAt(id, minutes(6))
    expect(await sync(link, 'a', minutes(7), minutes(2))).toMatchObject({
      unseen: 1,
    })
    expect(await seenAtOf(id, 'a')).toEqual(minutes(4))
  })

  test('keeps counting the notes pinned after what the page has shown', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    await subscribe(id, 'a')
    await noteAt(id, minutes(1))
    // Pinned after the page was rendered, so not loaded there
    await noteAt(id, minutes(3))
    expect(await sync(link, 'a', minutes(5), minutes(2))).toMatchObject({
      unseen: 1,
    })
    expect(await seenAtOf(id, 'a')).toEqual(minutes(2))
    // Nothing new up to what the page has shown: nothing is written
    expect(await sync(link, 'a', minutes(6), minutes(2.5))).toMatchObject({
      unseen: 1,
    })
    expect(await seenAtOf(id, 'a')).toEqual(minutes(2))
  })

  test('caps a point in the future at now', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    await subscribe(id, 'a')
    await noteAt(id, minutes(1))
    expect(await sync(link, 'a', minutes(5), minutes(60))).toMatchObject({
      unseen: 0,
    })
    expect(await seenAtOf(id, 'a')).toEqual(minutes(5))
    // A note pinned after that counts once it is there
    await noteAt(id, minutes(10))
    expect(await unseenCount(kita, endpointFor('a'), minutes(11))).toBe(1)
  })

  // PostgreSQL has no year 0: it used to fail the request with a 500
  test('refuses a point before the year 1 as invalid input', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    await subscribe(id, 'a')
    // async: the schema throws before the handler runs
    const call = async (until: string) =>
      push.sync.orThrow.call(visitorContext('192.0.2.81'), {
        kitaToken: link.kitaToken,
        seen: { boardId: id, until },
        endpoint: endpointFor('a'),
        keys: { p256dh: browser.p256dh, auth: browser.auth },
      })
    for (const until of ['0000-01-01T00:00:00Z', '0001-01-01T00:00:00+01:00']) {
      const error = await call(until).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(z.ZodError)
    }
    expect(await call('0001-01-01T00:00:00Z')).toEqual({
      boardIds: [id],
      unseen: 0,
      remaining: true,
    })
    expect(await seenAtOf(id, 'a')).toEqual(now)
  })

  test("never touches another Kita's board", async () => {
    const elsewhere = await newTestBoard(await newKita())
    await subscribe(elsewhere.id, 'a')
    await noteAt(elsewhere.id, minutes(1))
    const { kitaToken } = await newTestBoard(await newKita())
    // The endpoint still follows that board, elsewhere
    expect(
      await sync({ kitaToken, boardId: elsewhere.id }, 'a', minutes(5)),
    ).toEqual({ ok: true, boardIds: [], unseen: 0, remaining: true })
    expect(await seenAtOf(elsewhere.id, 'a')).toEqual(now)
  })
})

describe('push.unsubscribe', () => {
  test("answers the number left without the board's notes", async () => {
    const kita = await newKita()
    const off = await newTestBoard(kita)
    const kept = await newTestBoard(kita)
    for (const { id } of [off, kept]) {
      await subscribe(id, 'a')
      await noteAt(id, minutes(1))
    }
    expect(
      await unsubscribeFromBoard(
        { ...off.link, endpoint: endpointFor('a') },
        client,
        { now: minutes(5) },
      ),
    ).toMatchObject({ ok: true, unseen: 1, remaining: true })
  })
})

describe('a note the browser pins itself', () => {
  let schedule: ReturnType<typeof spyOn>

  beforeEach(() => {
    // The app's dispatcher stays out of it
    schedule = spyOn(pushDispatcher, 'schedule').mockImplementation(() => {})
  })

  afterEach(() => {
    schedule.mockRestore()
  })

  test('is seen once its board page syncs again, and counts for everyone else', async () => {
    const kita = await newKita()
    const { id, link } = await newTestBoard(kita)
    const subscribedAt = addDays(new Date(), -1)
    await subscribe(id, 'poster', subscribedAt)
    await subscribe(id, 'other', subscribedAt)
    await notes.create.orThrow.call(
      visitorContext('192.0.2.80'),
      await noteDraft(link, { ownEndpoint: endpointFor('poster') }),
    )
    // The page shows the note and syncs with its board (BoardApp.vue)
    const after = new Date()
    expect(await sync(link, 'poster', after)).toMatchObject({ unseen: 0 })
    expect(await unseenCount(kita, endpointFor('other'), after)).toBe(1)
    expect((await seenAtOf(id, 'other'))?.getTime()).toBe(
      subscribedAt.getTime(),
    )
  })
})
