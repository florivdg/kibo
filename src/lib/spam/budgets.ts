// How much a visitor, a network and a board may do in a given time. Plain
// data: the store in store.ts counts against these, nothing here touches a
// database. The reasoning behind every number — what normal Kita use looks
// like, why the board budgets sit as high as they do — is in
// docs/selbst-hosten/spam-schutz.md; keep the two in step when changing a
// value.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface Budget {
  name: string
  // Which of the subjects handed to the guard this budget counts
  subject:
    | 'client'
    | 'client56'
    | 'client48'
    | 'clientBoard'
    | 'clientNote'
    | 'note'
    | 'board'
    | 'kita'
    | 'recipient'
    | 'recipientClient'
    | 'account'
    | 'organization'
  windowMs: number
  max: number
  // Counts the tail of the previous window too, weighted by how much of the
  // current one has passed, so a client can't spend one budget just before a
  // window ends and another right after
  sliding?: boolean
}

// Posting a note, counted for the network it comes from. Keys on a whole /64
// or a single IPv4 address, so everyone in a Kita WLAN shares them. Checked
// before the board is even looked up.
export const NOTE_CLIENT_BUDGETS: Budget[] = [
  // A few notes in one sitting is normal, a dozen an hour is not
  {
    name: 'note:burst',
    subject: 'client',
    windowMs: 5 * MINUTE,
    max: 5,
    sliding: true,
  },
  {
    name: 'note:client-hour',
    subject: 'client',
    windowMs: HOUR,
    max: 12,
    sliding: true,
  },
  { name: 'note:client-day', subject: 'client', windowMs: DAY, max: 30 },
]

// The same for the wider IPv6 networks a client sits in, derived from the
// hourly and daily budget of one /64 (`<action>:client-hour`,
// `<action>:client-day`): its /56 — a home line, where a /64 each is free to
// have — gets three times both, its /48 — a server, a site — ten times the
// daily one. Each wider network only counts what passed the narrower one's
// budgets, so a noisy /64 or /56 can't spend what its neighbours share.
// IPv4 has none (src/lib/spam/client-ip.ts).
function widerNetworkBudgets(action: string, client: Budget[]): Budget[] {
  const named = (name: string) => {
    const found = client.find((budget) => budget.name === `${action}:${name}`)
    if (!found) throw new Error(`Kein Budget ${action}:${name}`)
    return found
  }
  const hour = named('client-hour')
  const day = named('client-day')
  return [
    {
      ...hour,
      name: `${action}:client56-hour`,
      subject: 'client56',
      max: hour.max * 3,
    },
    {
      ...day,
      name: `${action}:client56-day`,
      subject: 'client56',
      max: day.max * 3,
    },
    {
      ...day,
      name: `${action}:client48-day`,
      subject: 'client48',
      max: day.max * 10,
    },
  ]
}

export const NOTE_WIDE_CLIENT_BUDGETS = widerNetworkBudgets(
  'note',
  NOTE_CLIENT_BUDGETS,
)

// One network on one board, once the board exists. Even a busy parents'
// evening fills one board with fewer than this.
export const NOTE_CLIENT_BOARD_BUDGETS: Budget[] = [
  {
    name: 'note:client-board-day',
    subject: 'clientBoard',
    windowMs: DAY,
    max: 15,
  },
]

// The last line against a flood spread over many networks. Deliberately far
// above real use, because this is the one rule that could lock parents out —
// and only notes that are actually stored are counted here. Counted for the
// board under the Kita's current link, not the board alone: a new Kita link
// starts with a fresh budget, so renewing it ends an attack without leaving
// the board shut for the day.
export const NOTE_BOARD_BUDGETS: Budget[] = [
  { name: 'note:board-hour', subject: 'board', windowMs: HOUR, max: 60 },
  { name: 'note:board-day', subject: 'board', windowMs: DAY, max: 300 },
]

// The boards of one Kita together, so a Kita with eight boards doesn't take
// eight times the notes of one. Counted like the board budgets: for the Kita's
// current link, and only notes that are stored.
export const NOTE_KITA_BUDGETS: Budget[] = [
  { name: 'note:kita-hour', subject: 'kita', windowMs: HOUR, max: 120 },
  { name: 'note:kita-day', subject: 'kita', windowMs: DAY, max: 600 },
]

// Paging through a board: 120 requests are three thousand notes
export const NOTE_LIST_BUDGETS: Budget[] = [
  { name: 'note:list', subject: 'client', windowMs: 15 * MINUTE, max: 120 },
]

// Taking a note down again. Parents do that a few times a year; the budget
// only keeps a script from hammering the database with guessed keys.
export const NOTE_REMOVE_BUDGETS: Budget[] = [
  { name: 'note:remove', subject: 'client', windowMs: 15 * MINUTE, max: 30 },
]

// Web push: every call of push.sync, push.subscribe and push.unsubscribe. A
// subscribed browser syncs once on every page of its Kita it opens, and a
// board page once more whenever new notes show up on it, so this is sized
// like paging.
export const PUSH_REQUEST_BUDGETS: Budget[] = [
  { name: 'push:request', subject: 'client', windowMs: 15 * MINUTE, max: 120 },
]

// Subscriptions a network adds, not counting the ones it already has. Each
// board a phone turns the bell on for is one: a parents' evening in the Kita
// WLAN is a few dozen phones with several boards each; a script making up
// endpoints is thousands.
export const PUSH_SUBSCRIBE_BUDGETS: Budget[] = [
  {
    name: 'push:subscribe-client-hour',
    subject: 'client',
    windowMs: HOUR,
    max: 150,
    sliding: true,
  },
]

// Hard cap per board: far above any Kita group, and what keeps one board from
// turning every new note into thousands of requests
export const PUSH_BOARD_SUBSCRIPTION_CAP = 1000

// Notifications a board sends out, counted per fan-out to all its
// subscribers. Notes arriving in between are collected into the next one, so
// this is the most a flood of notes can make parents' phones buzz.
export const PUSH_BOARD_BUDGETS: Budget[] = [
  { name: 'push:board-hour', subject: 'board', windowMs: HOUR, max: 6 },
]

// Page views of the hosted start page that Kibo reports to Plausible
// (src/lib/analytics/pageview.ts): one per page load. A network that loads
// the start page more often than this is not counted any further — it is a
// script, and the counting is not for it to keep busy.
export const ANALYTICS_PAGEVIEW_BUDGETS: Budget[] = [
  {
    name: 'analytics:pageview',
    subject: 'client',
    windowMs: 15 * MINUTE,
    max: 30,
  },
]

// The same note twice on the same board is a mistake or a bot; the same note
// next week is a legitimate reminder.
export const DUPLICATE_WINDOW_MS = 24 * HOUR

// Reporting a note (notes.report), counted for the network first — before
// the board is looked up, like posting. Parents report a note now and then;
// a dozen reports an hour from one network is a script.
export const REPORT_CLIENT_BUDGETS: Budget[] = [
  {
    name: 'report:client-hour',
    subject: 'client',
    windowMs: HOUR,
    max: 10,
    sliding: true,
  },
  { name: 'report:client-day', subject: 'client', windowMs: DAY, max: 30 },
]

// The wider IPv6 networks, by the same factors as for notes
export const REPORT_WIDE_CLIENT_BUDGETS = widerNetworkBudgets(
  'report',
  REPORT_CLIENT_BUDGETS,
)

// One network on one board, once the link turned out to lead to one, and on
// one note: a whole Kita WLAN shares these, so a few parents may report the
// same note — the case takes them all in, and the admins hear of it once.
export const REPORT_CLIENT_BOARD_BUDGETS: Budget[] = [
  {
    name: 'report:client-board-day',
    subject: 'clientBoard',
    windowMs: DAY,
    max: 15,
  },
]

export const REPORT_CLIENT_NOTE_BUDGETS: Budget[] = [
  {
    name: 'report:client-note-day',
    subject: 'clientNote',
    windowMs: DAY,
    max: 3,
  },
]

// What a board takes in total, across every network, counted for the Kita's
// current link like the notes: the last line against a flood spread over many networks.
// Only reports that are stored count.
export const REPORT_BOARD_BUDGETS: Budget[] = [
  { name: 'report:board-hour', subject: 'board', windowMs: HOUR, max: 30 },
  { name: 'report:board-day', subject: 'board', windowMs: DAY, max: 100 },
]

// A report with the option „auch an den Betreiber“ (a notice of illegal
// content, DSA Art. 16) also writes to the operator, once per such report.
// The report budgets above hold for it as well; these keep the operator's
// mailbox from filling up on top of that: a note is mailed about only so
// often a day — the operator has the note's id after the first mail and acts
// on the note, not on the count —, and a board only so often across all of
// its notes. Counted in the transaction that files the report, so a note
// that is gone spends nothing; over them, the report is refused as a whole
// and can go to the Kita alone.
export const REPORT_OPERATOR_BUDGETS: Budget[] = [
  { name: 'report:operator-note-day', subject: 'note', windowMs: DAY, max: 5 },
  {
    name: 'report:operator-board-day',
    subject: 'board',
    windowMs: DAY,
    max: 20,
  },
]

// The mails about new cases, per Kita and recipient: at most one in this
// time, counted from the last mail the mail server took. Cases that come in
// between are not dropped — they wait in the outbox and go out together with
// the next mail (src/lib/reports/outbox.ts). Not a counter like the budgets
// above: a delivery that failed must not use up the hour of the one that
// follows it.
export const REPORT_MAIL_INTERVAL_MS = HOUR

// Signing in, counted per account (the normalised e-mail address) on top of
// Better Auth's per-network limit, so many networks together can't guess one
// password faster either. Every attempt counts, successful ones included: an
// admin signs in a handful of times a day.
export const SIGN_IN_BUDGETS: Budget[] = [
  {
    name: 'auth:sign-in-account',
    subject: 'account',
    windowMs: HOUR,
    max: 20,
    sliding: true,
  },
]

// Inviting someone to a Kita, counted for the Kita and for the owner who
// invites (the account, by user id), whatever address the invitation goes to.
// A Kita takes on a handful of admins in its lifetime, and a Träger with
// three Kitas a few more; what these stop is an account that uses the
// invitation mail to write to strangers. Each mail also counts against its
// recipient, below.
export const INVITATION_BUDGETS: Budget[] = [
  {
    name: 'invite:kita-hour',
    subject: 'organization',
    windowMs: HOUR,
    max: 10,
  },
  { name: 'invite:kita-day', subject: 'organization', windowMs: DAY, max: 30 },
  { name: 'invite:account-day', subject: 'account', windowMs: DAY, max: 50 },
]

// Asking for an invoice on the hosted instance (src/actions/subscription.ts),
// counted for the account that asks (by user id). Each request writes to the
// operator and to the address the invoice goes to: asking again is for a
// corrected address, not something to do all day. The confirmation also
// counts against its recipient, below.
export const INVOICE_REQUEST_BUDGETS: Budget[] = [
  { name: 'invoice:account-hour', subject: 'account', windowMs: HOUR, max: 2 },
  { name: 'invoice:account-day', subject: 'account', windowMs: DAY, max: 5 },
]

// Downloading a Kita's data (/admin/kita/export), counted for the account
// that asks (by user id) and then for the Kita. Each download reads every
// board and current note of the Kita: a few in a row are a retry, more are a
// script. The Kita's budget only counts what got past the account's, so one
// member hammering the button can't use up what the others share.
export const KITA_EXPORT_ACCOUNT_BUDGETS: Budget[] = [
  { name: 'export:account-hour', subject: 'account', windowMs: HOUR, max: 10 },
  { name: 'export:account-day', subject: 'account', windowMs: DAY, max: 15 },
]
export const KITA_EXPORT_KITA_BUDGETS: Budget[] = [
  { name: 'export:kita-day', subject: 'organization', windowMs: DAY, max: 30 },
]

// The mails Kibo sends on its own accord. Each kind has budgets of its own,
// so a flood of one kind can't hold back another: requesting reset mails for
// an address doesn't block the confirmation of an address change.
export type AuthMailKind =
  | 'verification'
  | 'reset'
  | 'email-change'
  | 'invitation'
  | 'invoice'
  | 'report-receipt'

// Per recipient address and kind, on top of Better Auth's per-network limits.
// Generous on purpose: a delivery the SMTP server refuses is only visible in
// the log, so it has spent its budget all the same. The recipient-client
// budgets are a slice of those: one network alone can't use up the whole
// budget of an address and lock its owner out.
interface MailBudgets {
  recipient: Budget[]
  recipientClient: Budget[]
}

function mailBudgets(kind: AuthMailKind): MailBudgets {
  return {
    recipient: [
      {
        name: `mail:${kind}:recipient-hour`,
        subject: 'recipient',
        windowMs: HOUR,
        max: 5,
      },
      {
        name: `mail:${kind}:recipient-day`,
        subject: 'recipient',
        windowMs: DAY,
        max: 10,
      },
    ],
    recipientClient: [
      {
        name: `mail:${kind}:recipient-client-hour`,
        subject: 'recipientClient',
        windowMs: HOUR,
        max: 3,
      },
      {
        name: `mail:${kind}:recipient-client-day`,
        subject: 'recipientClient',
        windowMs: DAY,
        max: 5,
      },
    ],
  }
}

export const MAIL_BUDGETS: Record<AuthMailKind, MailBudgets> = {
  verification: mailBudgets('verification'),
  reset: mailBudgets('reset'),
  'email-change': mailBudgets('email-change'),
  invitation: mailBudgets('invitation'),
  invoice: mailBudgets('invoice'),
  'report-receipt': mailBudgets('report-receipt'),
}

// Longest window in use; counters and retired keys are kept a little past it
export const MAX_WINDOW_MS = DAY

// Longest window a sliding budget looks back over. Its counter row has to
// outlive its own window by that much, so the lookback still finds it.
export const SLIDING_LOOKBACK_MS = HOUR

// "in etwa 5 Minuten" for the message shown to visitors
export function waitLabel(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE))
  if (minutes === 1) return 'einer Minute'
  if (minutes < 60) return `${minutes} Minuten`
  const hours = Math.ceil(minutes / 60)
  return hours === 1 ? 'einer Stunde' : `${hours} Stunden`
}
