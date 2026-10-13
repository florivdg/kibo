import { timestamp } from 'drizzle-orm/pg-core'

// When a row was created and when it was last changed, for the tables Kibo
// writes itself. A function, because every table needs column builders of
// its own.
export function changeTimestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  }
}
