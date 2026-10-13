import {
  and,
  count,
  eq,
  exists,
  gt,
  inArray,
  lt,
  lte,
  type SQL,
} from 'drizzle-orm'

import { db } from '@/db'
import { board, note, pushSubscription } from '@/db/schema'

// The number on the icon of the installed Kita app: the notes a browser
// hasn't seen yet on the boards whose bell it has on. Only the server knows
// when notes arrive and only the browser what it has looked at, so every
// subscription keeps when its board was last seen there (seenAt); boards
// without a bell don't count. Answered by push.sync and push.unsubscribe,
// and sent along with every notification (src/lib/push/dispatcher.ts).

// What an icon shows at most; more reads as "99"
export const BADGE_MAX = 99

// The unseen notes of each of these endpoints on the boards of one Kita, in
// one statement: notes on a board the endpoint is subscribed to, pinned
// after that subscription's seenAt and not yet expired. An endpoint without
// any isn't in the map.
export async function unseenCounts(
  organizationId: string,
  endpoints: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (!endpoints.length) return new Map()
  const rows = await db
    .select({ endpoint: pushSubscription.endpoint, unseen: count() })
    .from(pushSubscription)
    .innerJoin(
      board,
      and(
        eq(board.id, pushSubscription.boardId),
        eq(board.organizationId, organizationId),
        // Only boards that take subscriptions, like push.sync's bells
        eq(board.pushEnabled, true),
      ),
    )
    .innerJoin(note, newerNote(now))
    .where(inArray(pushSubscription.endpoint, endpoints))
    .groupBy(pushSubscription.endpoint)
  return new Map(
    rows.map(({ endpoint, unseen }) => [endpoint, Math.min(unseen, BADGE_MAX)]),
  )
}

// The same for a single endpoint
export async function unseenCount(
  organizationId: string,
  endpoint: string,
  now: Date,
) {
  const counts = await unseenCounts(organizationId, [endpoint], now)
  return counts.get(endpoint) ?? 0
}

// A note that counts for a subscription: on its board, pinned after its
// seenAt, still hanging
function newerNote(now: Date) {
  return and(
    eq(note.boardId, pushSubscription.boardId),
    gt(note.createdAt, pushSubscription.seenAt),
    gt(note.expiresAt, now),
  )
}

// This browser has seen the board up to `until`: a board page asked
// push.sync with its board and the newest point up to which it shows every
// note — its server time at rendering, or the newest note of a page it has
// loaded since (not a note it pinned itself, see loadedUntil in
// src/composables/use-note-pager.ts). Never later than `now`.
// `subscriptions` narrows the rows that may move (this endpoint's, on the
// boards of the Kita link). seenAt only ever moves forward, and only when a
// current note pinned after it and up to that point hangs there: a delayed
// older sync can't take it back, notes the page never loaded keep counting,
// and a view with nothing new writes nothing. Nothing happens on a board the
// browser has no bell on.
export function markBoardSeen(
  boardId: string,
  subscriptions: SQL | undefined,
  { until, now }: { until: Date; now: Date },
) {
  const at = until < now ? until : now
  return db
    .update(pushSubscription)
    .set({ seenAt: at })
    .where(
      and(
        subscriptions,
        eq(pushSubscription.boardId, boardId),
        lt(pushSubscription.seenAt, at),
        exists(
          db
            .select({ id: note.id })
            .from(note)
            .where(and(newerNote(now), lte(note.createdAt, at))),
        ),
      ),
    )
}
