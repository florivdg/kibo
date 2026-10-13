import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { board, kitaLink, pushSubscription } from '@/db/schema'
import type { Executor } from '@/db/types'
import { linkedBoard, linkedBoardIds } from '@/lib/board/kita-link'
import { findKita, findLinkedBoard, subscriberCount } from '@/lib/board/queries'
import { isLinkToken } from '@/lib/board/secrets'
import { addDays } from '@/lib/board/time'
import type { BoardLink } from '@/lib/board/types'
import { errorMessage } from '@/lib/error-message'
import { isPausedOn } from '@/lib/hosted/access'
import { HOSTED_PAUSED_VISITOR } from '@/lib/hosted/messages'
import { PUSH_SUBSCRIPTION_IDLE_DAYS } from '@/lib/limits'
import { PUSH_BOARD_SUBSCRIPTION_CAP } from '@/lib/spam/budgets'
import { allowNewPushSubscription, allowPushRequest } from '@/lib/spam/guard'
import { countSpamEvent } from '@/lib/spam/metrics'

import { pushConfigured } from './config'
import { hasValidKeys, isAllowedPushEndpoint } from './endpoint'
import { markBoardSeen, unseenCount } from './unseen'

// What the public push actions do, as plain functions: src/actions/push.ts
// only turns the outcome into an answer. Refusals carry the code the action
// answers with and, where a visitor should read it, a German message.
export type PushRefusal = {
  ok: false
  code:
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'TOO_MANY_REQUESTS'
    | 'CONFLICT'
    | 'PAYMENT_REQUIRED'
  message?: string
}

const NOT_FOUND: PushRefusal = { ok: false, code: 'NOT_FOUND' }
const SUBSCRIBED = { ok: true } as const

const BUSY: PushRefusal = {
  ok: false,
  code: 'TOO_MANY_REQUESTS',
  message:
    'Von hier kamen gerade sehr viele Anfragen. Bitte versuch es gleich nochmal.',
}

// A board of a Kita the hosted instance has paused takes no subscriptions
// and refreshes none (src/lib/hosted/access.ts)
const PAUSED: PushRefusal = {
  ok: false,
  code: 'PAYMENT_REQUIRED',
  message: HOSTED_PAUSED_VISITOR,
}

// One browser (or installed app) and its push subscription: one endpoint for
// every board of the Kita it follows
interface BrowserSubscription {
  kitaToken: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type SubscriptionInput = BrowserSubscription & { boardId: string }

// What a board page has shown: its board, up to this point in server time
interface SeenBoard {
  boardId: string
  until: Date
}

interface Options {
  now?: Date
  // Tests switch the feature off without touching the environment
  configured?: boolean
}

function withDefaults({
  now = new Date(),
  configured = pushConfigured(),
}: Options): Required<Options> {
  return { now, configured }
}

// What every push action asks first: push is configured, the link has the
// form of a Kita link — a malformed one can't be a Kita (like the page, 404)
// and never reaches the database —, and the network hasn't asked too often.
async function gate(
  kitaToken: string,
  client: string,
  { now, configured }: Required<Options>,
): Promise<PushRefusal | undefined> {
  if (!configured || !isLinkToken(kitaToken)) return NOT_FOUND
  if (!(await allowPushRequest(client, now))) return BUSY
}

// Everything the rules below say before a subscription is touched
async function precheck(
  input: BrowserSubscription,
  client: string,
  settings: Required<Options>,
): Promise<PushRefusal | undefined> {
  const refused = await gate(input.kitaToken, client, settings)
  if (refused) return refused
  const valid =
    isAllowedPushEndpoint(input.endpoint) && (await hasValidKeys(input.keys))
  return valid ? undefined : { ok: false, code: 'BAD_REQUEST' }
}

// The board behind the link, locked until the transaction ends, with what
// decides whether it takes subscriptions. The Kita link's row is locked
// first, FOR KEY SHARE: a renewal (rewriting the unique token takes its row
// FOR UPDATE) either waits for the subscription and then deletes it with the
// rest, or has already happened, and the old token finds nothing — while
// subscriptions to the Kita's other boards don't hold each other up. The
// board row FOR NO KEY UPDATE: notifications switched off either wait as
// well or leave a board that takes none, parallel subscriptions to it can't
// slip past the cap together, and notes being written aren't held up. What
// is joined to tell whether the Kita is paused isn't locked.
async function lockBoard(link: BoardLink, now: Date, tx: Executor) {
  const [kita] = await tx
    .select({ organizationId: kitaLink.organizationId })
    .from(kitaLink)
    .where(eq(kitaLink.token, link.kitaToken))
    .for('key share')
  if (!kita) return undefined
  const [row] = await linkedBoard(
    { id: board.id, pushEnabled: board.pushEnabled },
    link,
    tx,
  ).for('no key update', { of: board })
  return row && { ...row, paused: isPausedOn(row.subscription, now) }
}

// A new subscription, once the network may add one and the board has room.
// The board row is locked, so parallel requests can't slip past the cap
// together.
async function addSubscription(
  boardId: string,
  input: SubscriptionInput,
  client: string,
  now: Date,
  tx: Executor,
): Promise<{ ok: true } | PushRefusal> {
  if (!(await allowNewPushSubscription(client, now, tx))) {
    return {
      ok: false,
      code: 'TOO_MANY_REQUESTS',
      message:
        'Von hier aus wurden gerade sehr viele Geräte angemeldet. Bitte versuch es später nochmal.',
    }
  }
  if ((await subscriberCount(boardId, tx)) >= PUSH_BOARD_SUBSCRIPTION_CAP) {
    countSpamEvent('push:board-full')
    return {
      ok: false,
      code: 'CONFLICT',
      message:
        'Für dieses Brett sind schon sehr viele Geräte angemeldet. Bitte sprich die Kita darauf an.',
    }
  }
  await tx.insert(pushSubscription).values({
    boardId,
    endpoint: input.endpoint,
    ...input.keys,
    createdAt: now,
    lastVisitAt: now,
    // What the board had until now doesn't count toward the app's icon
    seenAt: now,
  })
  countSpamEvent('push:subscribed')
  return SUBSCRIBED
}

// push.subscribe: one board, idempotent. A browser the board already has
// only gets its keys refreshed (and counts as visiting); only a new
// subscription costs the network's budget and has to fit under the board's
// cap. The link is checked in the
// transaction that writes, so a subscription can't outlive the revocation it
// raced with.
export async function subscribeToBoard(
  input: SubscriptionInput,
  client: string,
  options: Options = {},
): Promise<{ ok: true } | PushRefusal> {
  const settings = withDefaults(options)
  const refused = await precheck(input, client, settings)
  if (refused) return refused
  return db.transaction(async (tx) => {
    const target = await lockBoard(input, settings.now, tx)
    if (target?.paused) return PAUSED
    if (!target?.pushEnabled) return NOT_FOUND
    const refreshed = await tx
      .update(pushSubscription)
      .set({ ...input.keys, lastVisitAt: settings.now })
      .where(
        and(
          eq(pushSubscription.boardId, target.id),
          eq(pushSubscription.endpoint, input.endpoint),
        ),
      )
      .returning({ id: pushSubscription.id })
    if (refreshed.length) return SUBSCRIBED
    return addSubscription(target.id, input, client, settings.now, tx)
  })
}

// Whether this browser still follows any board of the instance, in any
// Kita: one service worker and one endpoint serve them all in a browser
// (one per home-screen app on the iPhone)
async function followsAnyBoard(endpoint: string) {
  const [row] = await db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(eq(pushSubscription.endpoint, endpoint))
    .limit(1)
  return row !== undefined
}

// push.sync, once per page of the Kita: answers which of the Kita's boards
// this browser has a subscription on — what the bells show — refreshes the
// keys where they changed (its push service may have handed out new ones)
// and notes the visit (lastVisitAt, which keeps the subscription from being
// purged as idle) at most once a day — plenty against
// PUSH_SUBSCRIPTION_IDLE_DAYS; usually nothing is written. Never adds one:
// whatever the server dropped in the meantime (a renewed link, notifications switched off, a dead
// endpoint) stays dropped until someone taps a bell again. So it needs no
// lock: a revocation that deletes the rows either waits for the refresh or
// leaves nothing to find. The Kita comes first, to tell a link that leads
// nowhere or a paused Kita from "no bell on". `unseen` is the number for the
// app's icon (src/lib/push/unseen.ts); a board page sends `seen`, its board
// and the point it has shown it up to, and that board counts as seen up to
// there before the number is taken. `remaining`, as in push.unsubscribe:
// whether the endpoint still follows any board at all, in any Kita. Once it
// doesn't — the link was renewed, the Kita switched notifications off, the
// boards were deleted, the subscriptions purged — the page ends the
// browser's push subscription (src/composables/use-push-bells.ts).
export async function syncSubscriptions(
  input: BrowserSubscription & { seen?: SeenBoard },
  client: string,
  options: Options = {},
): Promise<
  | { ok: true; boardIds: string[]; unseen: number; remaining: boolean }
  | PushRefusal
> {
  const settings = withDefaults(options)
  const refused = await precheck(input, client, settings)
  if (refused) return refused
  const kita = await findKita(input.kitaToken, settings.now)
  if (!kita) return NOT_FOUND
  if (kita.paused) return PAUSED
  const ours = and(
    eq(pushSubscription.endpoint, input.endpoint),
    // Only boards that take subscriptions
    inArray(
      pushSubscription.boardId,
      linkedBoardIds(input.kitaToken, eq(board.pushEnabled, true)),
    ),
  )
  if (input.seen) {
    await markBoardSeen(input.seen.boardId, ours, {
      until: input.seen.until,
      now: settings.now,
    })
  }
  const [subscribed, unseen, remaining] = await Promise.all([
    db
      .select({ boardId: pushSubscription.boardId })
      .from(pushSubscription)
      .where(ours),
    unseenCount(kita.organizationId, input.endpoint, settings.now),
    followsAnyBoard(input.endpoint),
    db
      .update(pushSubscription)
      .set({ ...input.keys, lastVisitAt: settings.now })
      .where(
        and(
          ours,
          or(
            sql`(${pushSubscription.p256dh}, ${pushSubscription.auth}) is distinct from (${input.keys.p256dh}, ${input.keys.auth})`,
            lt(pushSubscription.lastVisitAt, addDays(settings.now, -1)),
          ),
        ),
      ),
  ])
  return {
    ok: true,
    boardIds: subscribed.map((row) => row.boardId),
    unseen,
    remaining,
  }
}

// push.unsubscribe: idempotent, and only for this one board — the same
// endpoint may stay subscribed to others. Works on a paused board as well:
// it only ever removes data. Answers the number left for the app's icon,
// without the board's notes, and whether the endpoint still follows any
// board at all: if not, that was the browser's last bell, and the page ends
// the browser's push subscription as well (src/composables/use-push-bells.ts).
export async function unsubscribeFromBoard(
  { kitaToken, boardId, endpoint }: Omit<SubscriptionInput, 'keys'>,
  client: string,
  options: Options = {},
): Promise<{ ok: true; unseen: number; remaining: boolean } | PushRefusal> {
  const settings = withDefaults(options)
  const refused = await gate(kitaToken, client, settings)
  if (refused) return refused
  const target = await findLinkedBoard({ kitaToken, boardId }, settings.now)
  if (!target) return NOT_FOUND
  await db
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.boardId, target.id),
        eq(pushSubscription.endpoint, endpoint),
      ),
    )
  const [unseen, remaining] = await Promise.all([
    unseenCount(target.organizationId, endpoint, settings.now),
    followsAnyBoard(endpoint),
  ])
  return { ok: true, unseen, remaining }
}

// With notifications switched off, nobody who subscribed before hears from
// the board again: one board, or several (a renewed Kita link drops those of
// all its boards: renewKitaLink in src/lib/board/mutations.ts)
export function deleteBoardSubscriptions(
  boards: string | string[],
  on: Executor = db,
) {
  return on
    .delete(pushSubscription)
    .where(
      typeof boards === 'string'
        ? eq(pushSubscription.boardId, boards)
        : inArray(pushSubscription.boardId, boards),
    )
}

const FAILURE_LIMIT = 3
const SILENCE_DAYS = 30

// Nothing reached the subscription since `since`: its last delivery, or its
// creation if it never had one, lies before it
function silentSince(since: Date) {
  return lt(
    sql`coalesce(${pushSubscription.lastSuccessAt}, ${pushSubscription.createdAt})`,
    since,
  )
}

// Called by the server's hourly timer (src/lib/server/runtime.ts). Two kinds
// go: subscriptions that keep failing and haven't received anything for 30
// days — the phone is gone, or its push service lost it without saying so —,
// and those nothing has come of for PUSH_SUBSCRIPTION_IDLE_DAYS: no page of
// the Kita opened in the browser (lastVisitAt) and no notification delivered
// to it — a quiet board, a paused Kita, a phone in a drawer. Either brings a
// subscription that is still wanted back into the window.
export async function purgeStaleSubscriptions(now: Date) {
  const idleSince = addDays(now, -PUSH_SUBSCRIPTION_IDLE_DAYS)
  try {
    await db
      .delete(pushSubscription)
      .where(
        or(
          and(
            gte(pushSubscription.failureCount, FAILURE_LIMIT),
            silentSince(addDays(now, -SILENCE_DAYS)),
          ),
          and(
            lt(pushSubscription.lastVisitAt, idleSince),
            silentSince(idleSince),
          ),
        ),
      )
  } catch (error) {
    console.error(
      `[push] Aufräumen der Abos fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
