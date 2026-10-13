// Limits the server enforces and the browser shows. Nothing here imports
// server code, so forms and error messages can use the same numbers.

// Kitas one account may create and own (organizationLimit in src/lib/auth.ts).
// A Träger runs a few; dozens are a script. Kitas the account was invited to
// don't count.
export const ORGANIZATION_LIMIT = 3

// The hosted instance (HOSTED=true) counts differently: one Kita during the
// trial, more with a paid subscription (src/lib/hosted/kita-limit.ts). This is
// the ceiling there — far above what a Träger runs, and what stops a script.
export const HOSTED_ORGANIZATION_CAP = 20

// What an account reads that has reached either of the two
export function kitaLimitMessage(limit: number) {
  return `Mit einem Konto lassen sich höchstens ${limit} Kitas anlegen.`
}

// What happens once a trial or a paid year of the hosted instance is over
// (src/lib/hosted/state.ts): for this many days everything keeps working …
export const HOSTED_GRACE_DAYS = 14
// … and this many days after the end, the account's Kitas are due to be
// deleted. In between they are paused.
export const HOSTED_DELETION_DAYS = 90
// The mails on the way there (src/lib/hosted/reminders.ts): one this many
// days before a trial or a paid year ends …
export const HOSTED_REMINDER_DAYS = 7
// … and one that announces the deletion. The Kitas only go once it is this
// many days old, however long ago the deadline itself passed.
export const HOSTED_DELETION_NOTICE_DAYS = 14
// An announcement that did not go out is sent again by a later hourly run,
// once the attempt is this old: longer than a slow mail server takes to
// answer, shorter than the hour between two runs.
export const HOSTED_NOTICE_RETRY_MINUTES = 30

// Where the invoice of the hosted instance goes: who it is made out to (a
// Kita, a Träger) and their address, a few lines
export const BILLING_NAME_MAX = 120
export const BILLING_ADDRESS_MAX = 400
// What the invoice has to carry for the Kita's administration: a Leitweg-ID
// (at most 46 characters) or a Träger's order number
export const BILLING_REFERENCE_MAX = 100
// The longest address a mail server takes
export const EMAIL_MAX_LENGTH = 254

// People who manage one Kita together: the owner and the admins they invited.
// A leadership team and a few deputies; a Träger with more runs several Kitas.
export const MEMBERSHIP_LIMIT = 10

// Invitations of one Kita that are still waiting for an answer
export const INVITATION_LIMIT = 10

// How long the link of an invitation works. Longer than the hour of the other
// links: it goes to someone who didn't ask for it just now. The mail and the
// settings page say this number.
export const INVITATION_TTL_DAYS = 7
export const INVITATION_TTL_S = INVITATION_TTL_DAYS * 24 * 60 * 60

// Reported notes (src/lib/reports/): how long a case is kept. A closed one
// goes this many days after it was closed …
export const REPORT_CLOSED_RETENTION_DAYS = 30
// … and every case, open or not, with its copy of the note, at the latest
// this many days after the first report. The hourly run deletes both
// (src/lib/server/runtime.ts).
export const REPORT_MAX_RETENTION_DAYS = 90
// Reports a case keeps with their reason and remarks; the ones that come on
// top only count
export const REPORTS_PER_CASE_MAX = 25

// A browser's subscription to a board's notifications (src/lib/push/) that
// nothing has come of for this many days — no page of the Kita opened in it
// and no notification delivered to it — is deleted by the hourly run
// (src/lib/server/runtime.ts): the phone is likely gone, and its consent
// shouldn't outlive it forever.
export const PUSH_SUBSCRIPTION_IDLE_DAYS = 180

export const ORGANIZATION_NAME_MAX = 100
// Whom parents ask about data protection on the hosted instance: an e-mail
// address or an https:// link (src/lib/board/privacy-contact.ts)
export const PRIVACY_CONTACT_MAX = 300

// A person's name, shown in mails Kibo sends
export const ACCOUNT_NAME_MAX = 80

// A password's length, for every way an account gets one: sign-up, reset,
// change and scripts/admin.ts. The upper bound is Better Auth's default.
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

// Passkeys of one account (src/lib/passkeys/): a phone, a laptop, a security
// key or two for each person who shares the account's devices — more is a
// script. The name is what the account page shows; it is optional.
export const PASSKEYS_PER_ACCOUNT = 10
export const PASSKEY_NAME_MAX = 60

// Kibo takes no uploads: the largest body is a note of a few kilobytes, and
// the auth API reads small JSON. Used for the adapter, the actions and the
// auth route alike.
export const REQUEST_BODY_LIMIT = 64 * 1024

// The form token a note is pinned with (src/lib/spam/form-token.ts): the
// composer fetches one when it opens, and the server takes it at the earliest
// this long after it was issued — a person doesn't fill in a note faster,
// and the composer waits out the rest if they do …
export const NOTE_FORM_TOKEN_MIN_AGE_MS = 3_000
// … and at the latest this long after: a composer left open longer fetches a
// fresh one before it sends
export const NOTE_FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60_000
