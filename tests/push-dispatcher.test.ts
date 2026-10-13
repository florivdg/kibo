import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { board, kitaLink, note, pushSubscription } from '@/db/schema'
import { instanceMode } from '@/lib/instance'
import { vapidConfig } from '@/lib/push/config'
import { createPushDispatcher } from '@/lib/push/dispatcher'
import { pushTopic, pushTopicKey } from '@/lib/push/message'
import { PUSH_BOARD_BUDGETS } from '@/lib/spam/budgets'

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
import { decryptPush, newBrowser, type Browser } from './helpers/push'
import { resetSpamCounters, testDb } from './helpers/spam-db'

const start = new Date('2026-05-04T10:00:00.000Z')
let organizationId: string

// A timer that never fires by itself: the tests flush when they want to, and
// look at what would have been scheduled
function manualTimer() {
  const pending = new Map<number, number>()
  let next = 0
  return {
    pending,
    set: (_run: () => void, ms: number) => {
      pending.set(++next, ms)
      return next
    },
    clear: (handle: unknown) => pending.delete(handle as number),
  }
}

interface Sent {
  endpoint: string
  init: RequestInit
}

type DispatcherOptions = NonNullable<Parameters<typeof createPushDispatcher>[0]>

let clock = start
let browsers: Browser[]

// A dispatcher on the test clock and a manual timer. Its push service answers
// with the given status per endpoint (201 when not listed) and keeps what it
// got, unless the test brings a fetch of its own.
function setup({
  statuses = {},
  fetch,
  config,
}: { statuses?: Record<string, number> } & Pick<
  DispatcherOptions,
  'fetch' | 'config'
> = {}) {
  const sent: Sent[] = []
  const timer = manualTimer()
  const dispatcher = createPushDispatcher({
    fetch:
      fetch ??
      (async (endpoint, init) => {
        sent.push({ endpoint, init })
        return new Response(null, { status: statuses[endpoint] ?? 201 })
      }),
    now: () => clock,
    timer,
    config,
  })
  return { sent, timer, dispatcher }
}

const endpointOf = (index: number) =>
  `https://fcm.googleapis.com/fcm/send/dispatch-${index}`

// A board with the given subscribers
async function newBoard(
  subscribers = 2,
  values: { pushEnabled?: boolean } = {},
) {
  const created = await newTestBoard(organizationId, values)
  if (subscribers) {
    await testDb.insert(pushSubscription).values(
      browsers.slice(0, subscribers).map((browser, index) => ({
        boardId: created.id,
        endpoint: endpointOf(index),
        p256dh: browser.p256dh,
        auth: browser.auth,
      })),
    )
  }
  return created.id
}

function newNote(boardId: string, title: string) {
  return insertTestNote(boardId, {
    title,
    body: 'Geheimer Text',
    author: 'Anna',
    contact: 'anna@example.org',
    createdAt: clock,
  })
}

async function notification({ endpoint, init }: Sent) {
  const index = Number(endpoint.split('-').at(-1))
  const body = await decryptPush(init.body as Uint8Array, browsers[index]!)
  return JSON.parse(body) as {
    notification: { title: string; body: string; navigate: string; tag: string }
    app_badge: string
  }
}

beforeAll(async () => {
  browsers = await Promise.all([newBrowser(), newBrowser(), newBrowser()])
  organizationId = await newTestKita()
})

beforeEach(async () => {
  clock = start
  await resetSpamCounters()
})

afterAll(() => removeTestKitas(organizationId))

describe('the push dispatcher', () => {
  test('bundles the notes of a board into one notification', async () => {
    const { sent, timer, dispatcher } = setup()
    const boardId = await newBoard()
    for (const title of ['Laternenfest', 'Flohmarkt', 'Ausflug']) {
      dispatcher.schedule(boardId, await newNote(boardId, title))
    }
    // One timer for the batch, not one per note
    expect([...timer.pending.values()]).toEqual([2 * 60_000])
    expect(sent).toHaveLength(0)

    await dispatcher.flush(boardId)
    expect(timer.pending.size).toBe(0)
    expect(sent.map((request) => request.endpoint).toSorted()).toEqual([
      endpointOf(0),
      endpointOf(1),
    ])
    const { notification: shown } = await notification(sent[0]!)
    expect(shown.title).toBe('Brett „Igelgruppe“')
    expect(shown.body).toBe('3 neue Zettel')
    // The board inside the Kita's app, under the Kita's current link
    const [{ token }] = await testDb
      .select({ token: kitaLink.token })
      .from(kitaLink)
      .where(eq(kitaLink.organizationId, organizationId))
    expect(shown.navigate).toBe(`http://localhost:4321/k/${token}/${boardId}/`)
    expect(shown.tag).toBe(`board-${boardId}`)
    // Neither text, author nor contact leave the server
    const plain = JSON.stringify(shown)
    for (const secret of ['Geheimer', 'Anna', 'anna@']) {
      expect(plain).not.toContain(secret)
    }
  })

  test('sends a request the push services accept', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard(1)
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    await dispatcher.flush(boardId)

    const { init } = sent[0]!
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const headers = new Headers(init.headers)
    expect(headers.get('content-encoding')).toBe('aes128gcm')
    expect(headers.get('ttl')).toBe('86400')
    expect(headers.get('urgency')).toBe('normal')
    // The HMAC of board and endpoint, never the board's id
    const key = await pushTopicKey(vapidConfig()!.privateKey)
    expect(headers.get('topic')).toBe(
      await pushTopic(boardId, sent[0]!.endpoint, key!),
    )
    expect(headers.get('topic')).not.toContain(boardId.slice(0, 8))
    expect(headers.get('authorization')).toStartWith('vapid t=')
    expect(headers.get('authorization')).toEndWith(
      `, k=${vapidConfig()!.publicKey}`,
    )
    const { notification: shown } = await notification(sent[0]!)
    expect(shown.body).toBe('Neuer Zettel: Laternenfest')
  })

  test('gives every subscriber of a board its own topic', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard(2)
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    await dispatcher.flush(boardId)

    expect(sent).toHaveLength(2)
    const key = await pushTopicKey(vapidConfig()!.privateKey)
    const topics = await Promise.all(
      sent.map(async ({ endpoint, init }) => {
        const topic = new Headers(init.headers).get('topic')
        expect(topic).toBe(await pushTopic(boardId, endpoint, key!))
        return topic
      }),
    )
    // Nothing in the headers links the two endpoints to the same board
    expect(topics[0]).not.toBe(topics[1])
  })

  test('records what the push service answered', async () => {
    const { dispatcher } = setup({
      statuses: {
        [endpointOf(0)]: 201,
        [endpointOf(1)]: 410,
        [endpointOf(2)]: 503,
      },
    })
    const boardId = await newBoard(3)
    await testDb
      .update(pushSubscription)
      .set({ failureCount: 2 })
      .where(eq(pushSubscription.boardId, boardId))
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    await dispatcher.flush(boardId)

    const rows = await subscribersOf(boardId)
    // 410: the subscription is gone for good
    expect(rows.map((row) => row.endpoint)).toEqual([
      endpointOf(0),
      endpointOf(2),
    ])
    expect(rows[0]).toMatchObject({ failureCount: 0, lastSuccessAt: clock })
    expect(rows[1]).toMatchObject({ failureCount: 3, lastSuccessAt: null })
  })

  test('counts a timeout or network error as a failure', async () => {
    const { dispatcher } = setup({
      fetch: () => Promise.reject(new Error('fetch failed')),
    })
    const boardId = await newBoard(1)
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    await dispatcher.flush(boardId)
    const [row] = await subscribersOf(boardId)
    expect(row?.failureCount).toBe(1)
  })

  test('leaves out notes taken down in the meantime', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard(1)
    const kept = await newNote(boardId, 'Laternenfest')
    const removed = await newNote(boardId, 'Tippfehler')
    dispatcher.schedule(boardId, kept)
    dispatcher.schedule(boardId, removed)
    await testDb.delete(note).where(eq(note.id, removed))
    await dispatcher.flush(boardId)
    const { notification: shown } = await notification(sent[0]!)
    expect(shown.body).toBe('Neuer Zettel: Laternenfest')

    // Nothing left at all: nothing goes out
    const gone = await newNote(boardId, 'Doch nicht')
    dispatcher.schedule(boardId, gone)
    await testDb.delete(note).where(eq(note.id, gone))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(1)
  })

  test("doesn't notify the poster about their own note", async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard(2)
    dispatcher.schedule(
      boardId,
      await newNote(boardId, 'Eigener'),
      endpointOf(0),
    )
    await dispatcher.flush(boardId)
    expect(sent.map((request) => request.endpoint)).toEqual([endpointOf(1)])

    // With someone else's note in the batch, the poster hears about that one
    dispatcher.schedule(
      boardId,
      await newNote(boardId, 'Eigener 2'),
      endpointOf(0),
    )
    dispatcher.schedule(boardId, await newNote(boardId, 'Fremder'))
    await dispatcher.flush(boardId)
    const own = sent
      .slice(1)
      .find((request) => request.endpoint === endpointOf(0))
    expect((await notification(own!)).notification.body).toBe(
      'Neuer Zettel: Fremder',
    )
  })

  test('tells every subscriber how many notes they have not seen yet', async () => {
    const { sent, dispatcher } = setup()
    const kita = await newTestKita()
    try {
      const boardId = (await newTestBoard(kita)).id
      const other = (await newTestBoard(kita)).id
      const minute = (n: number) => new Date(start.getTime() + n * 60_000)
      const subscribed = (id: string, index: number, seenAt: Date) => ({
        boardId: id,
        endpoint: endpointOf(index),
        p256dh: browsers[index]!.p256dh,
        auth: browsers[index]!.auth,
        seenAt,
      })
      // 0 and 1 follow both boards, 1 has seen the other one since its note;
      // 2 follows this board only and pins a note there itself (its board
      // page syncs again with the board, moving its seenAt past the note)
      await testDb
        .insert(pushSubscription)
        .values([
          subscribed(boardId, 0, minute(-1)),
          subscribed(boardId, 1, minute(-1)),
          subscribed(boardId, 2, start),
          subscribed(other, 0, minute(-1)),
          subscribed(other, 1, minute(1)),
        ])
      await insertTestNote(other, { createdAt: start })
      dispatcher.schedule(
        boardId,
        await newNote(boardId, 'Laternenfest'),
        endpointOf(2),
      )
      clock = minute(1)
      dispatcher.schedule(boardId, await newNote(boardId, 'Flohmarkt'))
      await dispatcher.flush(boardId)

      const shown = Object.fromEntries(
        await Promise.all(
          sent.map(async (request) => {
            const message = await notification(request)
            return [
              request.endpoint,
              [message.notification.body, message.app_badge],
            ]
          }),
        ),
      )
      expect(shown).toEqual({
        [endpointOf(0)]: ['2 neue Zettel', '3'],
        [endpointOf(1)]: ['2 neue Zettel', '2'],
        [endpointOf(2)]: ['Neuer Zettel: Flohmarkt', '1'],
      })
    } finally {
      await removeTestKitas(kita)
    }
  })

  test('holds notifications back once a board has sent its share', async () => {
    const { sent, timer, dispatcher } = setup()
    const boardId = await newBoard(1)
    const max = PUSH_BOARD_BUDGETS[0]!.max
    for (let i = 0; i < max; i++) {
      dispatcher.schedule(boardId, await newNote(boardId, `Zettel ${i}`))
      await dispatcher.flush(boardId)
    }
    expect(sent).toHaveLength(max)

    clock = new Date(start.getTime() + 20 * 60_000)
    dispatcher.schedule(boardId, await newNote(boardId, 'Gebremst'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(max)
    // Kept for when the hour is over, not dropped
    expect([...timer.pending.values()]).toEqual([40 * 60_000])

    // A note arriving meanwhile joins the batch that is held back
    dispatcher.schedule(boardId, await newNote(boardId, 'Dazu'))
    expect(timer.pending.size).toBe(1)

    clock = new Date(start.getTime() + 60 * 60_000)
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(max + 1)
    expect((await notification(sent.at(-1)!)).notification.body).toBe(
      '2 neue Zettel',
    )
  })

  test('sends nothing for a board that switched push off or is gone', async () => {
    const { sent, dispatcher } = setup()
    const off = await newBoard(1, { pushEnabled: false })
    dispatcher.schedule(off, await newNote(off, 'Leise'))
    await dispatcher.flush(off)

    const deleted = await newBoard(1)
    dispatcher.schedule(deleted, await newNote(deleted, 'Weg'))
    await testDb.delete(board).where(eq(board.id, deleted))
    await dispatcher.flush(deleted)
    expect(sent).toHaveLength(0)
  })

  test('checks the allow-list again right before sending', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard(0)
    await testDb.insert(pushSubscription).values({
      boardId,
      endpoint: 'https://169.254.169.254/latest/meta-data',
      p256dh: browsers[0]!.p256dh,
      auth: browsers[0]!.auth,
    })
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(0)
    expect(await subscribersOf(boardId)).toHaveLength(0)
  })

  test('drops a pending batch when the board is revoked', async () => {
    const { sent, timer, dispatcher } = setup()
    const boardId = await newBoard(1)
    dispatcher.schedule(boardId, await newNote(boardId, 'Vor dem neuen Link'))
    expect(timer.pending.size).toBe(1)
    dispatcher.cancel(boardId)
    expect(timer.pending.size).toBe(0)
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(0)

    // Notes after that start a batch of their own
    dispatcher.schedule(boardId, await newNote(boardId, 'Danach'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(1)
    expect((await notification(sent[0]!)).notification.body).toBe(
      'Neuer Zettel: Danach',
    )
  })

  test('stops a fan-out under way when the board is revoked', async () => {
    const boardId = await newBoard(0)
    const subscribers = 25
    await testDb.insert(pushSubscription).values(
      Array.from({ length: subscribers }, (_, index) => ({
        boardId,
        endpoint: `https://fcm.googleapis.com/fcm/send/slow-${index}`,
        p256dh: browsers[index % browsers.length]!.p256dh,
        auth: browsers[index % browsers.length]!.auth,
      })),
    )
    // A push service that takes its time until the test lets it answer
    const started: string[] = []
    let answer!: () => void
    const slow = new Promise<void>((resolve) => {
      answer = resolve
    })
    const { dispatcher } = setup({
      fetch: async (endpoint) => {
        started.push(endpoint)
        await slow
        return new Response(null, { status: 201 })
      },
    })
    dispatcher.schedule(boardId, await newNote(boardId, 'Laternenfest'))
    const running = dispatcher.flush(boardId)
    while (started.length < 10) await Bun.sleep(5)

    dispatcher.cancel(boardId)
    answer()
    await running
    // The requests already on their way finished, nothing else went out
    expect(started).toHaveLength(10)
    const reached = await subscribersOf(boardId)
    expect(reached.filter((row) => row.lastSuccessAt)).toHaveLength(10)
  })

  test('does nothing without VAPID keys or after SIGTERM', async () => {
    const unconfigured = setup({ config: () => null })
    const boardId = await newBoard(1)
    unconfigured.dispatcher.schedule(
      boardId,
      await newNote(boardId, 'Laternenfest'),
    )
    expect(unconfigured.timer.pending.size).toBe(0)
    await unconfigured.dispatcher.flush(boardId)
    expect(unconfigured.sent).toHaveLength(0)

    const { sent, timer, dispatcher } = setup()
    dispatcher.schedule(boardId, await newNote(boardId, 'Vor dem Stopp'))
    dispatcher.stop()
    expect(timer.pending.size).toBe(0)
    dispatcher.schedule(boardId, await newNote(boardId, 'Nach dem Stopp'))
    await dispatcher.flush(boardId)
    await dispatcher.settle(1_000)
    expect(sent).toHaveLength(0)
  })
})

// The Kita's subscription on the hosted instance (src/lib/hosted/access.ts)
describe('the push dispatcher on the hosted instance', () => {
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

  test('sends nothing for a paused Kita, and spends none of the board’s budget', async () => {
    const { sent, timer, dispatcher } = setup()
    const boardId = await newBoard()
    await setTestSubscription(ownerId, 'paused', start)
    instanceMode.hosted = true

    dispatcher.schedule(boardId, await newNote(boardId, 'Pausiert'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(0)
    // Dropped, not kept for later
    expect(timer.pending.size).toBe(0)
    expect(
      (await subscribersOf(boardId)).map((row) => row.lastSuccessAt),
    ).toEqual([null, null])

    // Paid for again, the board still has its whole hour: a flush that was
    // counted while it was paused would leave one notification short
    await setTestSubscription(ownerId, 'active', start)
    const max = PUSH_BOARD_BUDGETS[0]!.max
    for (let i = 0; i < max; i++) {
      dispatcher.schedule(boardId, await newNote(boardId, `Zettel ${i}`))
      await dispatcher.flush(boardId)
    }
    expect(sent).toHaveLength(max * 2)
    expect((await notification(sent.at(-1)!)).notification.body).toBe(
      `Neuer Zettel: Zettel ${max - 1}`,
    )
  })

  test('sends as ever in the grace period', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard()
    await setTestSubscription(ownerId, 'grace', start)
    instanceMode.hosted = true

    dispatcher.schedule(boardId, await newNote(boardId, 'Kulanz'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(2)
  })

  test('a Kita paused while the notification waited gets none', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard()
    await setTestSubscription(ownerId, 'grace', start)
    instanceMode.hosted = true
    dispatcher.schedule(boardId, await newNote(boardId, 'Knapp'))

    // The grace period ends before the batch goes out
    clock = new Date(start.getTime() + 10 * 24 * 60 * 60_000)
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(0)
  })

  test('sends without HOSTED, whatever a subscription says', async () => {
    const { sent, dispatcher } = setup()
    const boardId = await newBoard()
    await setTestSubscription(ownerId, 'deletable', start)

    dispatcher.schedule(boardId, await newNote(boardId, 'Selbst gehostet'))
    await dispatcher.flush(boardId)
    expect(sent).toHaveLength(2)
  })
})
