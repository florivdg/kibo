import { DrizzleQueryError } from 'drizzle-orm'

// Logs get the reason, never the error object: a pg error carries the SQL
// parameters (mail addresses, note text), a pool error its configuration
// including the password, and nodemailer's the recipient.
//
// Drizzle wraps a failed statement as "Failed query: <sql>\nparams: <values>"
// — the values are what must stay out (push endpoints and keys, among others),
// so only the statement is kept. The pg error it wraps (`cause`) stays out
// too: its message may quote a value.
export function errorMessage(error: unknown) {
  if (error instanceof DrizzleQueryError) return `Failed query: ${error.query}`
  return error instanceof Error ? error.message : 'unbekannter Fehler'
}
