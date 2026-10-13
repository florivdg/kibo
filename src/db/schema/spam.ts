import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { note } from './board'

// Spam protection state. Shared by every app process, so limits survive
// restarts and can't be multiplied by starting a second instance.

// Keys the counters and fingerprints below are derived with. They live in the
// database rather than in a process (or in BETTER_AUTH_SECRET) so neither a
// restart nor rotating the auth secret hands out a fresh budget. Rotating a
// spam key means inserting a new row: the newest key is used for writing and
// the older ones keep being counted until they are cleaned up.
export const spamKey = pgTable('spam_key', {
  id: text('id').primaryKey(),
  // 32 random bytes, base64
  secret: text('secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// One row per budget and fixed time window. The bucket is an HMAC over the
// budget name, the subject (client network, board or mail recipient) and the
// start of the window — never a raw IP address, board token or e-mail address.
export const spamCounter = pgTable(
  'spam_counter',
  {
    bucket: text('bucket').primaryKey(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('spam_counter_expiresAt_idx').on(table.expiresAt)],
)

// HMAC of a board and the normalised text of a note, to catch the same note
// being posted again (or in parallel) within the duplicate window. The note
// text itself is never stored here.
export const spamFingerprint = pgTable(
  'spam_fingerprint',
  {
    fingerprint: text('fingerprint').primaryKey(),
    // The note this text became, once it was stored. Removing that note — by
    // its author, by an admin, or when it expires — takes the fingerprint with
    // it, so the same text can be pinned again right away.
    noteId: text('note_id').references(() => note.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('spam_fingerprint_expiresAt_idx').on(table.expiresAt),
    // Deleting a note looks up its fingerprint through the foreign key
    index('spam_fingerprint_noteId_idx').on(table.noteId),
  ],
)
