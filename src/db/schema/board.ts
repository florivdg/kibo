import { desc } from 'drizzle-orm'
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

// Relative import: drizzle-kit doesn't resolve the @/ alias
import { BOARD_TYPE_IDS } from '../../lib/board/board-types'
import { organization } from './auth'
import { changeTimestamps } from './timestamps'

export const boardType = pgEnum('board_type', BOARD_TYPE_IDS)

// The id of a row Kibo creates itself. Functions, because every table needs
// column builders of its own.
export function uuidPrimaryKey() {
  return text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
}

// The Kita a row belongs to; deleting the Kita deletes the row
export function kitaColumn() {
  return text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })
}

// The Kita's public link /k/<token>/: one secret for every board of the
// Kita, each at /k/<token>/<boardId>/ (the board id is no secret). Its own
// table rather than a column of better-auth's organization, so the auth
// schema stays generated. Created the first time an admin page reads the
// link (kitaLinkOf in src/lib/board/kita-link.ts) or by renewKitaLink
// (src/lib/board/mutations.ts); renewing it locks out everyone who only has
// the old one. The one row Kibo keeps per Kita, so it also holds what the
// Kita's public pages say about it besides the name: whom parents ask about
// data protection (src/lib/board/privacy-contact.ts) — read with the link by
// every public lookup, kept across renewals.
export const kitaLink = pgTable('kita_link', {
  organizationId: kitaColumn().primaryKey(),
  token: text('token').notNull().unique(),
  // Hosted instance only: an e-mail address or an https:// link, as
  // normalizePrivacyContact left it; null for none
  privacyContact: text('privacy_contact'),
  ...changeTimestamps(),
})

export const board = pgTable(
  'board',
  {
    id: uuidPrimaryKey(),
    organizationId: kitaColumn(),
    type: boardType('type').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // Whether visitors may turn on notifications for new notes. Switching it
    // off removes the existing subscriptions.
    pushEnabled: boolean('push_enabled').notNull().default(true),
    ...changeTimestamps(),
  },
  (table) => [index('board_organizationId_idx').on(table.organizationId)],
)

// Id and board of a row that belongs to one board and goes with it. A
// function, because every table needs column builders of its own.
export function boardOwnedColumns() {
  return {
    id: uuidPrimaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
  }
}

export const note = pgTable(
  'note',
  {
    ...boardOwnedColumns(),
    categoryId: text('category_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    author: text('author').notNull(),
    contact: text('contact'),
    // SHA-256 of the key the poster's browser keeps to take the note down
    deleteKeyHash: text('delete_key_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('note_boardId_expiresAt_idx').on(table.boardId, table.expiresAt),
    // Keyset paging of a board's notes, newest first
    index('note_boardId_createdAt_idx').on(
      table.boardId,
      desc(table.createdAt),
      desc(table.id),
    ),
    index('note_expiresAt_idx').on(table.expiresAt),
  ],
)
