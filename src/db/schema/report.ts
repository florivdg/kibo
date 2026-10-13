import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Relative import: drizzle-kit doesn't resolve the @/ alias
import {
  REPORT_CASE_STATUSES,
  REPORT_REASON_IDS,
  REPORT_RESOLUTIONS,
} from '../../lib/reports/types'
import { user } from './auth'
import { boardOwnedColumns, kitaColumn, note, uuidPrimaryKey } from './board'

export const reportReason = pgEnum('report_reason', REPORT_REASON_IDS)
export const reportCaseStatus = pgEnum(
  'report_case_status',
  REPORT_CASE_STATUSES,
)
export const reportResolution = pgEnum('report_resolution', REPORT_RESOLUTIONS)

// Notes visitors reported (src/lib/reports/). Every report of the same note
// while it is open lands in one case, which the Kita's admins close under
// /admin/reports. The case keeps a copy of the note as the server read it
// when it was first reported, so it can be checked after the note was taken
// down or ran out: deleting the note only empties `noteId`. Deleting the
// board or the Kita takes the case with it, and the hourly run deletes it
// after a fixed time (REPORT_*_RETENTION_DAYS in src/lib/limits.ts). Nothing
// here says who reported: no address, no account, no network.
export const reportCase = pgTable(
  'report_case',
  {
    ...boardOwnedColumns(),
    organizationId: kitaColumn(),
    // The note while it hangs; null once it was taken down or deleted
    noteId: text('note_id').references(() => note.id, {
      onDelete: 'set null',
    }),
    // The note as it was reported
    noteCategoryId: text('note_category_id').notNull(),
    noteTitle: text('note_title').notNull(),
    noteBody: text('note_body').notNull(),
    noteAuthor: text('note_author').notNull(),
    noteContact: text('note_contact'),
    noteCreatedAt: timestamp('note_created_at', {
      withTimezone: true,
    }).notNull(),
    noteExpiresAt: timestamp('note_expires_at', {
      withTimezone: true,
    }).notNull(),
    status: reportCaseStatus('status').notNull().default('open'),
    // Every report the case took, the ones not kept as a row included
    reportCount: integer('report_count').notNull().default(1),
    firstReportedAt: timestamp('first_reported_at', {
      withTimezone: true,
    }).notNull(),
    lastReportedAt: timestamp('last_reported_at', {
      withTimezone: true,
    }).notNull(),
    // Who closed it, when, and whether the note went with it. The operator
    // closes a case without an account here, by taking its note down with
    // scripts/admin.ts (remove-note), and so overrides a Kita that closed it
    // keeping the note: `closedBy` stays empty then.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    closedByOperator: boolean('closed_by_operator').notNull().default(false),
    resolution: reportResolution('resolution'),
  },
  (table) => [
    // One open case per note: parallel reports meet here, and only one of
    // them creates the case (src/lib/reports/mutations.ts)
    uniqueIndex('report_case_open_note_idx')
      .on(table.noteId)
      .where(sql`${table.status} = 'open'`),
    index('report_case_organizationId_status_idx').on(
      table.organizationId,
      table.status,
      table.lastReportedAt,
    ),
    index('report_case_boardId_idx').on(table.boardId),
    // The hourly retention run
    index('report_case_firstReportedAt_idx').on(table.firstReportedAt),
    index('report_case_closedAt_idx').on(table.closedAt),
  ],
)

// Id and case of a row that belongs to one case and goes with it
function caseOwnedColumns() {
  return {
    id: uuidPrimaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => reportCase.id, { onDelete: 'cascade' }),
  }
}

// One report of a case: the reason and what the visitor added. A case keeps
// at most REPORTS_PER_CASE_MAX of them; what comes on top is only counted.
export const noteReport = pgTable(
  'note_report',
  {
    ...caseOwnedColumns(),
    reason: reportReason('reason').notNull(),
    // Empty when the visitor added nothing, or the same text as an earlier
    // report of the note
    remarks: text('remarks').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('note_report_caseId_idx').on(table.caseId)],
)

export const reportNotificationStatus = pgEnum('report_notification_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
])

// The mails about new cases, one row per case and recipient: written in the
// transaction that creates the case, for every owner and admin of the Kita
// at that moment, and worked off after the commit and by a periodic sweep
// (src/lib/reports/outbox.ts). A row is claimed before its mail goes out
// (`claimedUntil`), so neither a second process nor a restart sends it
// twice or loses it; a failed delivery is tried again later, a few times.
export const reportNotification = pgTable(
  'report_notification',
  {
    ...caseOwnedColumns(),
    organizationId: kitaColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: reportNotificationStatus('status').notNull().default('pending'),
    // Deliveries tried so far
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
    }).notNull(),
    // A process is sending this one until then
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('report_notification_case_user_unique').on(
      table.caseId,
      table.userId,
    ),
    index('report_notification_due_idx').on(table.status, table.nextAttemptAt),
    index('report_notification_recipient_idx').on(
      table.organizationId,
      table.userId,
    ),
    index('report_notification_userId_idx').on(table.userId),
  ],
)
