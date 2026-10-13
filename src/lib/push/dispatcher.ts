import { and, eq, gt, inArray, sql } from 'drizzle-orm'

import { db } from '@/db'
import { board, kitaLink, note, pushSubscription } from '@/db/schema'
import { errorMessage } from '@/lib/error-message'
import { kitaLinkOn } from '@/lib/board/kita-link'
import { isPausedOn, withSubscription } from '@/lib/hosted/access'
import { settleWithin } from '@/lib/server/settle-within'
import { allowBoardPush } from '@/lib/spam/guard'
import { countSpamEvent } from '@/lib/spam/metrics'

import { vapidConfig, type VapidConfig } from './config'
import { isAllowedPushEndpoint, pushServiceHost } from './endpoint'
import {
  notificationPlaintext,
  pushRequest,
  pushTopic,
  pushTopicKey,
  type BoardNews,
} from './message'
import { unseenCounts } from './unseen'
import { importVapidKey, vapidAuthorization, type VapidSigner } from './vapid'

// Sends the notifications for new notes. Notes on one board are collected for
// a couple of minutes and go out as one notification ("3 neue Zettel"), each
// board is throttled on top of that, and everything happens after the note
// is stored and outside the request that stored it. Pending notifications
// live in this process only: a restart loses them, which is fine for a nudge
// to look at the board.

const DEBOUNCE_MS = 2 * 60_000
const SEND_TIMEOUT_MS = 10_000
const CONCURRENCY = 10

interface Timer {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimer: Timer = {
  // unref: a pending notification must not keep the process alive
  set: (run, ms) => setTimeout(run, ms).unref(),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

// fetch() as far as sending needs it; the tests hand in a fake push service
type Send = (endpoint: string, init: RequestInit) => Promise<Response>

interface DispatcherOptions {
  fetch?: Send
  now?: () => Date
  timer?: Timer
  config?: () => VapidConfig | null
}

// Note id → the endpoint of the browser that posted it, if it is subscribed
type BatchNotes = Map<string, string | undefined>

interface Batch {
  notes: BatchNotes
  timer: unknown
}

interface Subscriber {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type Delivery = { subscriber: Subscriber; plaintext: Uint8Array<ArrayBuffer> }

// One fan-out under way; cancel() marks it, and what hasn't started stays put
interface Run {
  boardId: string
  cancelled: boolean
  done: Promise<void>
}

// What the push service's answer means for the subscription
const OUTCOMES = ['sent', 'gone', 'failed'] as const
type Outcome = (typeof OUTCOMES)[number]

function outcomeOf(status: number): Outcome {
  if (status >= 200 && status < 300) return 'sent'
  return status === 404 || status === 410 ? 'gone' : 'failed'
}

// The push service refused the request itself, which is our fault, not the
// subscriber's: worth a line in the log. Timeouts, 429 and 5xx only count.
const REJECTED = new Set([400, 401, 403, 413])

async function eachLimited<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!
      await run(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
}

// The board, if it still sends notifications: push switched on, and its Kita
// not paused on the hosted instance since the note was pinned
// (src/lib/hosted/access.ts). With the Kita's current link, which the
// notification opens: every subscription came through it, and a renewal
// takes them all.
async function sendingBoard(boardId: string, at: Date) {
  const [row] = await withSubscription(
    board,
    {
      name: board.name,
      organizationId: board.organizationId,
      kitaToken: kitaLink.token,
    },
    and(eq(board.id, boardId), eq(board.pushEnabled, true)),
  ).innerJoin(kitaLink, kitaLinkOn())
  return row && !isPausedOn(row.subscription, at) ? row : undefined
}

// The notes of the batch that are still there: one taken down right after
// posting never goes out
function liveNotes(boardId: string, ids: string[], now: Date) {
  return db
    .select({ id: note.id, title: note.title })
    .from(note)
    .where(
      and(
        eq(note.boardId, boardId),
        inArray(note.id, ids),
        gt(note.expiresAt, now),
      ),
    )
    .orderBy(note.createdAt)
}

function readSubscribers(boardId: string) {
  return db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      p256dh: pushSubscription.p256dh,
      auth: pushSubscription.auth,
    })
    .from(pushSubscription)
    .where(eq(pushSubscription.boardId, boardId))
}

// What the push services answered, in one statement per outcome
async function record(outcomes: Record<Outcome, string[]>, at: Date) {
  for (const outcome of OUTCOMES) {
    const { length } = outcomes[outcome]
    if (length) countSpamEvent(`push:${outcome}`, length)
  }
  const { sent, failed, gone } = outcomes
  if (sent.length) {
    await db
      .update(pushSubscription)
      .set({ lastSuccessAt: at, failureCount: 0 })
      .where(inArray(pushSubscription.id, sent))
  }
  if (failed.length) {
    await db
      .update(pushSubscription)
      .set({ failureCount: sql`${pushSubscription.failureCount} + 1` })
      .where(inArray(pushSubscription.id, failed))
  }
  if (gone.length) {
    await db.delete(pushSubscription).where(inArray(pushSubscription.id, gone))
  }
}

// Who gets what: every subscriber the notes they didn't post themselves, and
// the number for their app's icon. Each payload is built for its subscriber;
// it is encrypted for each of them anyway.
function deliveries(
  news: Omit<BoardNews, 'titles' | 'badge'>,
  notes: { id: string; title: string }[],
  ownEndpoints: BatchNotes,
  subscribers: Subscriber[],
  badges: Map<string, number>,
): Delivery[] {
  return subscribers.flatMap((subscriber) => {
    const titles = notes
      .filter((entry) => ownEndpoints.get(entry.id) !== subscriber.endpoint)
      .map((entry) => entry.title)
    if (!titles.length) return []
    const badge = badges.get(subscriber.endpoint) ?? 0
    const plaintext = notificationPlaintext({ ...news, titles, badge })
    return [{ subscriber, plaintext }]
  })
}

// Everything a fan-out sends, read at `at`. Nothing without a board that
// sends, notes still there or subscribers: the batch is dropped then, and
// the board's budget stays untouched.
async function plan(
  boardId: string,
  batchNotes: BatchNotes,
  at: Date,
): Promise<Delivery[]> {
  const [target, notes, subscribers] = await Promise.all([
    sendingBoard(boardId, at),
    liveNotes(boardId, [...batchNotes.keys()], at),
    readSubscribers(boardId),
  ])
  if (!target || !notes.length || !subscribers.length) return []
  // Each subscriber's number for the app's icon, as of now, in one query
  const badges = await unseenCounts(
    target.organizationId,
    subscribers.map((subscriber) => subscriber.endpoint),
    at,
  )
  return deliveries(
    { boardId, boardName: target.name, kitaToken: target.kitaToken },
    notes,
    batchNotes,
    subscribers,
    badges,
  )
}

export function createPushDispatcher({
  fetch: send = fetch,
  now = () => new Date(),
  timer = realTimer,
  config = vapidConfig,
}: DispatcherOptions = {}) {
  const batches = new Map<string, Batch>()
  const runs = new Set<Run>()
  let signer: Promise<VapidSigner> | undefined
  let topicKey: Promise<CryptoKey | undefined> | undefined
  let stopped = false

  function vapidSigner(vapid: VapidConfig) {
    signer ??= importVapidKey(vapid.privateKey).then((privateKey) => ({
      publicKey: vapid.publicKey,
      privateKey,
      subject: vapid.subject,
    }))
    return signer
  }

  // The key of the Topic headers, derived once per process
  function topicKeyOf(vapid: VapidConfig) {
    topicKey ??= pushTopicKey(vapid.privateKey)
    return topicKey
  }

  // The board's pending batch, taken out of the queue with its timer stopped
  function takeBatch(boardId: string) {
    const batch = batches.get(boardId)
    if (batch) {
      timer.clear(batch.timer)
      batches.delete(boardId)
    }
    return batch
  }

  // Merges notes into the board's pending batch and (re)arms its timer
  function enqueue(boardId: string, notes: BatchNotes, ms: number) {
    const merged = new Map([...(takeBatch(boardId)?.notes ?? []), ...notes])
    batches.set(boardId, {
      notes: merged,
      timer: timer.set(() => void flush(boardId), ms),
    })
  }

  // A note was stored. Never throws and never waits: the visitor's request
  // is done before any of this happens.
  function schedule(boardId: string, noteId: string, ownEndpoint?: string) {
    if (stopped || !config()) return
    const pending = batches.get(boardId)
    // The first note of a batch sets the clock; later ones ride along
    if (pending) pending.notes.set(noteId, ownEndpoint)
    else enqueue(boardId, new Map([[noteId, ownEndpoint]]), DEBOUNCE_MS)
  }

  // One request to one push service, and what its answer means
  async function attempt(
    { subscriber, plaintext }: Delivery,
    topicFor: (endpoint: string) => Promise<string | undefined>,
    authorization: (endpoint: string) => Promise<string>,
  ): Promise<Outcome> {
    // The allow-list once more, right before the request leaves
    if (!isAllowedPushEndpoint(subscriber.endpoint)) return 'gone'
    let status = 0
    try {
      const init = await pushRequest(subscriber, plaintext, {
        topic: await topicFor(subscriber.endpoint),
        authorization: await authorization(subscriber.endpoint),
      })
      const response = await send(subscriber.endpoint, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      status = response.status
      await response.body?.cancel()
    } catch {
      // Timeout or network error: counts as a failure like a 5xx
    }
    if (REJECTED.has(status)) {
      console.warn(
        `[push] ${pushServiceHost(subscriber.endpoint)} lehnt die Nachricht ab (${status})`,
      )
    }
    return outcomeOf(status)
  }

  // Sends to everyone planned, at most CONCURRENCY at a time, and records
  // the answers once all are in
  async function deliverAll(
    planned: Delivery[],
    topicFor: (endpoint: string) => Promise<string | undefined>,
    vapid: VapidSigner,
    run: Run,
  ) {
    // The VAPID token's audience is the push service, so one per service
    const tokens = new Map<string, Promise<string>>()
    const at = now()
    const authorization = (endpoint: string) => {
      const origin = new URL(endpoint).origin
      let token = tokens.get(origin)
      if (!token) {
        token = vapidAuthorization(endpoint, vapid, at)
        tokens.set(origin, token)
      }
      return token
    }
    const outcomes: Record<Outcome, string[]> = {
      sent: [],
      gone: [],
      failed: [],
    }
    await eachLimited(planned, CONCURRENCY, async (delivery) => {
      if (run.cancelled) return
      const outcome = await attempt(delivery, topicFor, authorization)
      outcomes[outcome].push(delivery.subscriber.id)
    })
    try {
      await record(outcomes, now())
    } catch (error) {
      console.error(`[push] Zustellung nicht vermerkt: ${errorMessage(error)}`)
    }
  }

  async function fanOut(
    boardId: string,
    batch: Batch,
    vapid: VapidConfig,
    run: Run,
  ) {
    const at = now()
    const planned = await plan(boardId, batch.notes, at)
    if (!planned.length) return

    if (run.cancelled) return
    const { allowed, retryAfterMs } = await allowBoardPush(boardId, at)
    if (run.cancelled) return
    if (!allowed) {
      // Held back, not dropped: the notes go out with the next window, together
      // with whatever arrives until then
      if (retryAfterMs && !stopped) enqueue(boardId, batch.notes, retryAfterMs)
      return
    }
    const [key, signing] = await Promise.all([
      topicKeyOf(vapid),
      vapidSigner(vapid),
    ])
    // Per board and subscriber, so the push services can't tell which
    // endpoints follow the same board
    const topicFor = async (endpoint: string) =>
      key && pushTopic(boardId, endpoint, key)
    await deliverAll(planned, topicFor, signing, run)
  }

  // Sends the board's pending batch now. The timer calls it; tests do too.
  function flush(boardId: string) {
    const batch = takeBatch(boardId)
    const vapid = config()
    if (!batch || !vapid) return Promise.resolve()

    const run: Run = { boardId, cancelled: false, done: Promise.resolve() }
    run.done = fanOut(boardId, batch, vapid, run)
      .catch((error: unknown) => {
        console.error(`[push] Versand fehlgeschlagen: ${errorMessage(error)}`)
      })
      .finally(() => runs.delete(run))
    runs.add(run)
    return run.done
  }

  // The Kita link was renewed, notifications were switched off or the board
  // is gone: its pending batch is dropped, and a fan-out under way sends nothing
  // more. Requests already on their way finish; everyone they reach was a
  // subscriber when it started.
  function cancel(boardId: string) {
    takeBatch(boardId)
    for (const run of runs) {
      if (run.boardId === boardId) run.cancelled = true
    }
  }

  // SIGTERM: pending batches are dropped, nothing new is scheduled
  function stop() {
    stopped = true
    for (const boardId of batches.keys()) takeBatch(boardId)
  }

  // Waits for the sends already under way, but no longer than the server
  // waits for its requests
  function settle(timeoutMs: number) {
    const running = [...runs].map((run) => run.done)
    return settleWithin(Promise.allSettled(running), timeoutMs)
  }

  return { schedule, flush, cancel, stop, settle }
}

// The app's one dispatcher: notes.create schedules, the board mutations
// (src/lib/board/mutations.ts) cancel, runtime.ts stops it
export const pushDispatcher = createPushDispatcher()
