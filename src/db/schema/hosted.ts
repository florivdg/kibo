import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { changeTimestamps } from './timestamps'

// The subscription of an account on the hosted instance (HOSTED=true): one row
// per account that pays — the owner of its Kitas, however many those are. The
// table exists in every instance and stays empty without HOSTED. The state
// (trial, active, grace, paused, due for deletion) is not stored: it follows
// from these dates and the clock (src/lib/hosted/state.ts).
export const hostedSubscription = pgTable('hosted_subscription', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  // The trial starts when the account creates its first Kita
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).notNull(),
  // Null until the first payment. Set by the operator (scripts/admin.ts).
  paidUntil: timestamp('paid_until', { withTimezone: true }),
  // Free for good, e.g. the operator's own Kita: always active, never billed
  complimentary: boolean('complimentary').notNull().default(false),
  // Where the invoice goes, and when the account last asked for one
  billingName: text('billing_name'),
  billingAddress: text('billing_address'),
  billingEmail: text('billing_email'),
  // A Leitweg-ID or order number the invoice has to carry; null for none
  billingReference: text('billing_reference'),
  invoiceRequestedAt: timestamp('invoice_requested_at', { withTimezone: true }),
  // The terms the account agreed to before its first Kita
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  // How many reminders of the current period's end have gone out
  reminderStage: integer('reminder_stage').notNull().default(0),
  // When the mail went out that announces the deletion of the account's
  // Kitas. They are only deleted once that is long enough ago.
  deletionNoticeAt: timestamp('deletion_notice_at', { withTimezone: true }),
  // When the Kitas were deleted. The account and this row stay; there is
  // nothing left to remind it of until it pays again.
  kitasDeletedAt: timestamp('kitas_deleted_at', { withTimezone: true }),
  // Until when the automatic deletion of the account's Kitas waits: set by
  // the operator (`hold-deletion` in scripts/admin.ts) after a request to
  // switch providers or to have the data erased (the AGB's section on data
  // export and switching). Until that moment no announcement of the deletion
  // goes out and nothing is deleted on its own; the Kitas stay as they are —
  // paused stays paused, the export keeps working. Null for no hold.
  deletionHeldUntil: timestamp('deletion_held_until', { withTimezone: true }),
  ...changeTimestamps(),
})

// The terms and the data processing agreement as they read under each
// HOSTED_TERMS_VERSION, kept for good: an account agrees to one version, and
// that text has to stay retrievable at its own address (/agb/<version>,
// /avv/<version>). Written by the server when it starts with a version it
// hasn't stored yet (src/lib/hosted/terms.ts); a version that is stored with
// a different text stops the start. A text is null where the operator
// publishes the document under AGB_URL / AVV_URL instead of a file: that
// page is theirs to archive.
export const legalTermsVersion = pgTable('legal_terms_version', {
  version: text('version').primaryKey(),
  agb: text('agb'),
  avv: text('avv'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
