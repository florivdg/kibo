import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { boardOwnedColumns } from './board'

// A browser that asked to be notified about new notes on a board. Subscribed
// through the Kita link: one push endpoint per browser or installed app
// serves every board of the Kita, so the same endpoint is subscribed to
// several boards — once per board. Removed with the board, when the Kita
// link is renewed, when the admin switches notifications off, when the
// push service says the endpoint is gone, and by the hourly run once it
// keeps failing or nothing has come of it for a long time
// (purgeStaleSubscriptions in src/lib/push/subscriptions.ts).
export const pushSubscription = pgTable(
  'push_subscription',
  {
    ...boardOwnedColumns(),
    // Only ever one of the push services on the allow-list
    // (src/lib/push/endpoint.ts)
    endpoint: text('endpoint').notNull(),
    // The browser's P-256 public key and auth secret, base64url
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Until when this browser has seen the board: notes created after it
    // count toward the number on the app's icon (src/lib/push/unseen.ts).
    // Moves on when a board page syncs with its board (push.sync).
    seenAt: timestamp('seen_at', { withTimezone: true }).defaultNow().notNull(),
    // When a page of the Kita last synced this browser (push.sync, at most
    // once a day) or a bell subscribed it; the subscription's creation at first
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    // Failed deliveries in a row; a success resets it
    failureCount: integer('failure_count').notNull().default(0),
  },
  (table) => [
    // Also serves every lookup by board
    unique('push_subscription_boardId_endpoint_unique').on(
      table.boardId,
      table.endpoint,
    ),
    // Whether a browser still follows any board of the instance, once a
    // bell was switched off (unsubscribeFromBoard)
    index('push_subscription_endpoint_idx').on(table.endpoint),
  ],
)
