import { db } from '@/db'
import type { Executor } from '@/db/types'
import { normalizeEmail } from '@/lib/email'
import { errorMessage } from '@/lib/error-message'
import { maskAddress } from '@/lib/mail/transport-options'
import { trustedProxies } from '@/lib/trusted-proxies'

import {
  ANALYTICS_PAGEVIEW_BUDGETS,
  DUPLICATE_WINDOW_MS,
  INVITATION_BUDGETS,
  INVOICE_REQUEST_BUDGETS,
  KITA_EXPORT_ACCOUNT_BUDGETS,
  KITA_EXPORT_KITA_BUDGETS,
  MAIL_BUDGETS,
  NOTE_BOARD_BUDGETS,
  NOTE_CLIENT_BOARD_BUDGETS,
  NOTE_CLIENT_BUDGETS,
  NOTE_KITA_BUDGETS,
  NOTE_LIST_BUDGETS,
  NOTE_REMOVE_BUDGETS,
  NOTE_WIDE_CLIENT_BUDGETS,
  PUSH_BOARD_BUDGETS,
  PUSH_REQUEST_BUDGETS,
  PUSH_SUBSCRIBE_BUDGETS,
  REPORT_BOARD_BUDGETS,
  REPORT_CLIENT_BOARD_BUDGETS,
  REPORT_CLIENT_BUDGETS,
  REPORT_CLIENT_NOTE_BUDGETS,
  REPORT_OPERATOR_BUDGETS,
  REPORT_WIDE_CLIENT_BUDGETS,
  SIGN_IN_BUDGETS,
  waitLabel,
  type AuthMailKind,
  type Budget,
} from './budgets'
import {
  clientNetworks,
  UNKNOWN_CLIENT,
  type ClientNetworks,
} from './client-ip'
import { normalizeContent } from './content'
import { isValidFormToken, issueFormToken } from './form-token'
import { countSpamEvent, type SpamEvent } from './metrics'
import { createSpamStore } from './store'

const store = createSpamStore(db)

// Drops counters and fingerprints whose window is over. Runs on the server's
// hourly timer (src/lib/server/runtime.ts) rather than alongside a request, so
// an instance nobody writes on cleans up as well.
export async function cleanupSpamState(now = new Date()) {
  try {
    await store.cleanup(now)
  } catch (error) {
    console.error(
      `[spam] Aufräumen der Zähler fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}

export interface LimitVerdict {
  allowed: boolean
  // German, with the wait; ready to show next to the untouched form
  message?: string
  retryAfterMs?: number
}

// What a visitor reads ("du") when the storage cannot answer …
const UNAVAILABLE =
  'Wir können gerade nicht prüfen, ob dein Zettel durchgeht. Bitte versuch es in ein paar Minuten nochmal.'

// … and how a refusal is worded for an admin ("Sie"), where a budget is said
// openly: the wait when it is used up, and the same about the storage
const FORMAL = {
  refusal: (retryAfterMs: number) =>
    `Bitte versuchen Sie es in ${waitLabel(retryAfterMs)} noch einmal.`,
  unavailable:
    'Das lässt sich gerade nicht prüfen. Bitte versuchen Sie es in ein paar Minuten noch einmal.',
}

// The network a request comes from, with the wider IPv6 networks it sits in:
// those for the budgets of posting and reporting
export function noteClientNetworks(
  request: Request,
  clientAddress: string | undefined,
) {
  return clientNetworks(
    request.headers.get('x-forwarded-for'),
    clientAddress,
    trustedProxies,
  )
}

export function noteClientIdentity(
  request: Request,
  clientAddress: string | undefined,
) {
  return noteClientNetworks(request, clientAddress).client
}

// Same identity for a request that reaches Better Auth. Astro leaves the
// address of the connection on the request under this symbol; a request
// Better Auth has cloned on the way has lost it, and the header decides alone.
function requestClientIdentity(request: Request | undefined) {
  if (!request) return UNKNOWN_CLIENT
  const address: unknown = Reflect.get(
    request,
    Symbol.for('astro.clientAddress'),
  )
  return noteClientIdentity(
    request,
    typeof address === 'string' ? address : undefined,
  )
}

// Every check answers the same way, and a storage that cannot answer counts as
// a refusal: the note needs the same database to be written anyway, so waving
// it through would buy nothing.
async function checked(
  what: string,
  run: () => Promise<LimitVerdict>,
  unavailable: SpamEvent,
  message = UNAVAILABLE,
): Promise<LimitVerdict> {
  try {
    return await run()
  } catch (error) {
    countSpamEvent(unavailable)
    console.error(`[spam] ${what}: ${errorMessage(error)}`)
    return { allowed: false, message }
  }
}

interface LimitOptions {
  budgets: Budget[]
  subjects: Parameters<typeof store.consume>[1]
  now: Date
  on?: Executor
  // Counted when the attempt got through / was turned away
  events?: { allowed?: SpamEvent; limited?: SpamEvent }
  // Gets the wait of the strictest window that ran out; without it, the
  // caller words the refusal itself
  refusal?: (retryAfterMs: number) => string
}

async function within({
  budgets,
  subjects,
  now,
  on,
  events,
  refusal,
}: LimitOptions): Promise<LimitVerdict> {
  const { allowed, retryAfterMs } = await store.consume(
    budgets,
    subjects,
    now,
    on,
  )
  const event = allowed ? events?.allowed : events?.limited
  if (event) countSpamEvent(event)
  return allowed
    ? { allowed: true }
    : { allowed: false, message: refusal?.(retryAfterMs), retryAfterMs }
}

function tooManyNotes(retryAfterMs: number) {
  return `Von hier aus wurden gerade ungewöhnlich viele Zettel angepinnt. Bitte versuch es in ${waitLabel(
    retryAfterMs,
  )} nochmal — dein Text bleibt so lange stehen.`
}

// The board's and the Kita's budgets are shared by everyone, so their refusal
// doesn't blame the visitor's network
function tooManyOnBoard(retryAfterMs: number) {
  return `Auf diesem Brett oder in dieser Kita wurden gerade ungewöhnlich viele Zettel angepinnt. Bitte versuch es in ${waitLabel(
    retryAfterMs,
  )} nochmal — dein Text bleibt so lange stehen.`
}

// A network's own budgets first, then its /56, then its /48. Each wider
// network only counts attempts that got past the narrower one: rotating
// through a blocked /56 cannot spend what neighbouring /56s share. Every
// attempt counts on each level it reaches, refused or not.
async function withinNetworks(
  { client, ...wider }: ClientNetworks,
  [own, wide]: [Budget[], Budget[]],
  now: Date,
  options: Pick<LimitOptions, 'events' | 'refusal'>,
) {
  const verdict = await within({
    budgets: own,
    subjects: { client },
    now,
    ...options,
  })
  if (!verdict.allowed) return verdict
  for (const subject of ['client56', 'client48'] as const) {
    if (wider[subject] === undefined) continue
    const widerVerdict = await within({
      budgets: wide.filter((budget) => budget.subject === subject),
      subjects: { [subject]: wider[subject] },
      now,
      ...options,
    })
    if (!widerVerdict.allowed) return widerVerdict
  }
  return { allowed: true }
}

// What one network may post at all. Checked first and on its own — before the
// board is looked up, so a script knocking with made-up links pays for every
// try — and a client that is already over its budget spends nothing else:
// otherwise one address could shut a board down for everyone just by being
// noisy.
export function allowNotePost(networks: ClientNetworks, now = new Date()) {
  return checked(
    'Budgetprüfung fehlgeschlagen',
    () =>
      withinNetworks(
        networks,
        [NOTE_CLIENT_BUDGETS, NOTE_WIDE_CLIENT_BUDGETS],
        now,
        { events: { limited: 'note:limited' }, refusal: tooManyNotes },
      ),
    'note:unavailable',
  )
}

// Whether a note comes with a form token the board's composer was handed
// (src/lib/spam/form-token.ts). Refused without a message: the action
// answers like any invalid input. A storage that can't read the keys refuses
// with the usual sentence.
export function allowNoteFormToken(
  token: string,
  boardId: string,
  now = new Date(),
) {
  return checked(
    'Formular-Token nicht prüfbar',
    async () => {
      if (await isValidFormToken(store, token, boardId, now)) {
        return { allowed: true }
      }
      countSpamEvent('note:token')
      return { allowed: false }
    },
    'note:unavailable',
  )
}

// A form token for the composer of this board
export function issueNoteFormToken(boardId: string, now = new Date()) {
  return issueFormToken(store, boardId, now)
}

// The same for notes.formToken: a storage that can't read the keys refuses
// with the usual sentence, and then there is no token
export async function allowNoteFormTokenIssue(
  boardId: string,
  now = new Date(),
): Promise<LimitVerdict & { token?: string }> {
  let token: string | undefined
  const verdict = await checked(
    'Formular-Token nicht ausstellbar',
    async () => {
      token = await issueNoteFormToken(boardId, now)
      return { allowed: true }
    },
    'note:unavailable',
  )
  return { ...verdict, token }
}

// What one network may post on one board, once the link turned out to lead
// to one. Keyed like the board budgets below: by the board under the Kita's
// current link (boardBudgetKey in src/lib/board/kita-link.ts).
export function allowClientBoardPost(
  client: string,
  boardKey: string,
  now = new Date(),
) {
  return checked(
    'Budgetprüfung fehlgeschlagen',
    () =>
      within({
        budgets: NOTE_CLIENT_BOARD_BUDGETS,
        subjects: { clientBoard: `${client}|${boardKey}` },
        now,
        events: { allowed: 'note:allowed', limited: 'note:limited' },
        refusal: tooManyNotes,
      }),
    'note:unavailable',
  )
}

// What a board takes in total, and all boards of its Kita together, both
// counted for the Kita's current link: `board` is the board's budget key,
// `kita` the Kita token. Counted inside the transaction that writes the note,
// so a note that is rolled back — a duplicate, a failed insert — gives both
// budgets back.
export function allowBoardPost(
  { board, kita }: { board: string; kita: string },
  now: Date,
  on: Executor,
) {
  return checked(
    'Brettbudget nicht prüfbar',
    () =>
      within({
        budgets: [...NOTE_BOARD_BUDGETS, ...NOTE_KITA_BUDGETS],
        subjects: { board, kita },
        now,
        on,
        events: { limited: 'note:board-limited' },
        refusal: tooManyOnBoard,
      }),
    'note:unavailable',
  )
}

// A budget per network whose refusal the action words itself
async function allowForClient(
  what: string,
  budgets: Budget[],
  { limited, unavailable }: { limited: SpamEvent; unavailable: SpamEvent },
  client: string,
  now: Date,
  on?: Executor,
) {
  const { allowed } = await checked(
    what,
    () =>
      within({ budgets, subjects: { client }, now, on, events: { limited } }),
    unavailable,
  )
  return allowed
}

// Paging through a board is cheap but not free
export function allowNoteList(client: string, now = new Date()) {
  return allowForClient(
    'Leselimit nicht prüfbar',
    NOTE_LIST_BUDGETS,
    { limited: 'note:list-limited', unavailable: 'note:unavailable' },
    client,
    now,
  )
}

// Taking a note down costs a lookup with a guessed key; a few are enough
export function allowNoteRemoval(client: string, now = new Date()) {
  return allowForClient(
    'Löschlimit nicht prüfbar',
    NOTE_REMOVE_BUDGETS,
    { limited: 'note:remove-limited', unavailable: 'note:unavailable' },
    client,
    now,
  )
}

// Every push.sync, push.subscribe and push.unsubscribe, whatever it asks for
export function allowPushRequest(client: string, now = new Date()) {
  return allowForClient(
    'Push-Limit nicht prüfbar',
    PUSH_REQUEST_BUDGETS,
    { limited: 'push:request-limited', unavailable: 'push:unavailable' },
    client,
    now,
  )
}

// A page view of the start page that Kibo reports to Plausible
export function allowAnalyticsPageview(client: string, now = new Date()) {
  return allowForClient(
    'Zählbudget nicht prüfbar',
    ANALYTICS_PAGEVIEW_BUDGETS,
    { limited: 'analytics:limited', unavailable: 'analytics:unavailable' },
    client,
    now,
  )
}

// A subscription the board doesn't have yet. Refreshing existing ones (the
// page's push.sync on every visit) costs nothing here. Counted inside the
// transaction that adds it, next to the board's cap.
export function allowNewPushSubscription(
  client: string,
  now: Date,
  on: Executor,
) {
  return allowForClient(
    'Push-Limit nicht prüfbar',
    PUSH_SUBSCRIBE_BUDGETS,
    { limited: 'push:subscribe-limited', unavailable: 'push:unavailable' },
    client,
    now,
    on,
  )
}

// One more notification to everyone subscribed to a board. Refused, the
// sender keeps the notes and tries again after retryAfterMs; a storage that
// cannot answer leaves no retryAfterMs, and the notification is dropped.
export function allowBoardPush(boardId: string, now = new Date()) {
  return checked(
    'Push-Drossel nicht prüfbar',
    () =>
      within({
        budgets: PUSH_BOARD_BUDGETS,
        subjects: { board: boardId },
        now,
        events: { limited: 'push:throttled' },
      }),
    'push:unavailable',
  )
}

// Another sign-in attempt for this account. Refused means: wait, whatever the
// password. The address is only ever used as an HMAC subject.
export function allowSignIn(email: string, now = new Date()) {
  return checked(
    'Anmeldebudget nicht prüfbar',
    () =>
      within({
        budgets: SIGN_IN_BUDGETS,
        subjects: { account: normalizeEmail(email) },
        now,
        events: { limited: 'signin:limited' },
      }),
    'signin:unavailable',
  )
}

// Another invitation from this Kita, sent by this owner. Refused means: wait —
// said openly, since whoever asks is signed in and owns the Kita. What the
// invited address itself still takes is asked right after
// (allowInvitationMail below).
export function allowInvitation(
  organizationId: string,
  inviterId: string,
  now = new Date(),
) {
  return checked(
    'Einladungsbudget nicht prüfbar',
    () =>
      within({
        budgets: INVITATION_BUDGETS,
        subjects: { organization: organizationId, account: inviterId },
        now,
        events: { limited: 'invite:limited' },
      }),
    'invite:unavailable',
  )
}

// Whether another mail of this kind may go to this address. Two steps: what
// the requesting network may still ask for, and only then what the address
// takes in total — a network that is over its share must not spend the rest
// of the address's budget with its refused attempts. With `wording` the
// refusal comes with its sentence; without, the caller words it or says
// nothing.
function allowMail(
  email: string,
  kind: AuthMailKind,
  request: Request | undefined,
  now: Date,
  wording?: typeof FORMAL,
) {
  const recipient = normalizeEmail(email)
  const client = requestClientIdentity(request)
  const budgets = MAIL_BUDGETS[kind]
  const refusal = wording?.refusal
  return checked(
    'Versandbudget nicht prüfbar',
    async () => {
      const share = await within({
        budgets: budgets.recipientClient,
        subjects: { recipientClient: `${recipient}|${client}` },
        now,
        events: { limited: 'mail:limited' },
        refusal,
      })
      if (!share.allowed) return share
      return within({
        budgets: budgets.recipient,
        subjects: { recipient },
        now,
        events: { allowed: 'mail:allowed', limited: 'mail:limited' },
        refusal,
      })
    },
    'mail:unavailable',
    wording?.unavailable,
  )
}

// The mails an account asks for itself: confirmation, reset, address change.
// Over the budget, the mail is dropped without a word to the caller, so the
// log has to say it.
export async function allowAuthMail(
  email: string,
  kind: AuthMailKind,
  request?: Request,
  now = new Date(),
) {
  const { allowed } = await allowMail(email, kind, request, now)
  if (!allowed) {
    console.warn(
      `[mail] Versand an ${maskAddress(email)} unterdrückt (${kind}): Budget erschöpft oder nicht prüfbar`,
    )
  }
  return allowed
}

// The mail of an invitation, asked before the invitation is created: the
// owner hears the refusal with its wait, like the one of allowInvitation, and
// the link the address already has stays as it is.
export function allowInvitationMail(
  email: string,
  request?: Request,
  now = new Date(),
) {
  return allowMail(email, 'invitation', request, now)
}

// Another invoice request of this account on the hosted instance. Refused
// means: wait — said openly, with the wait, to the owner who is signed in.
// What the address the confirmation goes to still takes is asked right after
// (allowInvoiceMail below).
export function allowInvoiceRequest(userId: string, now = new Date()) {
  return checked(
    'Budget für Rechnungsanfragen nicht prüfbar',
    () =>
      within({
        budgets: INVOICE_REQUEST_BUDGETS,
        subjects: { account: userId },
        now,
        events: { limited: 'invoice:limited' },
        refusal: FORMAL.refusal,
      }),
    'invoice:unavailable',
    FORMAL.unavailable,
  )
}

// The confirmation of an invoice request, which goes to an address the
// account typed: counted like an invitation, per network and in total, and
// asked before anything is stored
export function allowInvoiceMail(
  email: string,
  request?: Request,
  now = new Date(),
) {
  return allowMail(email, 'invoice', request, now, FORMAL)
}

// Another download of a Kita's data by this account. Refused means: wait —
// said openly, with the wait, to the member who is signed in. The account's
// budgets first; the Kita's, which all its members share, only counts what
// got past them.
export function allowKitaExport(
  userId: string,
  organizationId: string,
  now = new Date(),
) {
  const options: Pick<LimitOptions, 'now' | 'events' | 'refusal'> = {
    now,
    events: { limited: 'export:limited' },
    refusal: FORMAL.refusal,
  }
  return checked(
    'Exportbudget nicht prüfbar',
    async () => {
      const account = await within({
        budgets: KITA_EXPORT_ACCOUNT_BUDGETS,
        subjects: { account: userId },
        ...options,
      })
      if (!account.allowed) return account
      return within({
        budgets: KITA_EXPORT_KITA_BUDGETS,
        subjects: { organization: organizationId },
        ...options,
      })
    },
    'export:unavailable',
    FORMAL.unavailable,
  )
}

// Whether this text is new in `scope` within the duplicate window, claimed
// for the note in the caller's transaction. Text with nothing left after
// normalising (only punctuation, say) has nothing to compare and is new.
async function claimFreshContent(
  scope: string,
  parts: string[],
  noteId: string,
  now: Date,
  on: Executor,
) {
  const content = normalizeContent(parts)
  if (!content) return true
  return store.claimContent(
    scope,
    content,
    noteId,
    DUPLICATE_WINDOW_MS,
    now,
    on,
  )
}

// Claims the text of the note that was just written, in the same transaction.
// Not allowed means the identical text is already pinned on this board. A note
// with nothing left after normalising (only punctuation, say) has nothing to
// compare and is never a duplicate.
export function claimNoteContent(
  boardId: string,
  parts: string[],
  noteId: string,
  now: Date,
  on: Executor,
) {
  return checked(
    'Duplikatprüfung fehlgeschlagen',
    async () => {
      if (await claimFreshContent(`note|${boardId}`, parts, noteId, now, on)) {
        return { allowed: true }
      }
      countSpamEvent('note:duplicate')
      return {
        allowed: false,
        message:
          'Dieser Zettel hängt hier schon. Schau auf dem Brett nach — oder ändere den Text, wenn du etwas anderes meinst.',
      }
    },
    'note:unavailable',
  )
}

// Reporting a note (notes.report). Worded for the visitor ("du") like the
// refusals of a note, and the same three steps: the network on its own
// before the board is looked up, then the network on this board and on this
// note, and the board in total inside the transaction that stores the report.

const REPORT_UNAVAILABLE =
  'Wir können deine Meldung gerade nicht prüfen. Bitte versuch es in ein paar Minuten nochmal.'

function tooManyReports(retryAfterMs: number) {
  return `Von hier aus wurden gerade ungewöhnlich viele Zettel gemeldet. Bitte versuch es in ${waitLabel(
    retryAfterMs,
  )} nochmal.`
}

function checkedReport(run: () => Promise<LimitVerdict>) {
  return checked(
    'Meldebudget nicht prüfbar',
    run,
    'report:unavailable',
    REPORT_UNAVAILABLE,
  )
}

// How a report budget words and counts a refusal, unless a caller says
// otherwise
const REPORT_LIMITS: Pick<LimitOptions, 'events' | 'refusal'> = {
  refusal: tooManyReports,
  events: { limited: 'report:limited' },
}

function allowReportWithin(
  budgets: Budget[],
  subjects: Parameters<typeof store.consume>[1],
  now: Date,
  options: Pick<LimitOptions, 'on' | 'events' | 'refusal'> = {},
) {
  return checkedReport(() =>
    within({ budgets, subjects, now, ...REPORT_LIMITS, ...options }),
  )
}

export function allowReport(networks: ClientNetworks, now = new Date()) {
  return checkedReport(() =>
    withinNetworks(
      networks,
      [REPORT_CLIENT_BUDGETS, REPORT_WIDE_CLIENT_BUDGETS],
      now,
      REPORT_LIMITS,
    ),
  )
}

export function allowClientBoardReport(
  client: string,
  boardKey: string,
  now = new Date(),
) {
  return allowReportWithin(
    REPORT_CLIENT_BOARD_BUDGETS,
    { clientBoard: `${client}|${boardKey}` },
    now,
  )
}

// The same network on the same note: a second parent in the Kita WLAN may
// still report it, a script hammering one note may not. Said as what it is —
// the note has been reported, the Kita hears of it.
export function allowClientNoteReport(
  client: string,
  noteId: string,
  now = new Date(),
) {
  return allowReportWithin(
    REPORT_CLIENT_NOTE_BUDGETS,
    { clientNote: `${client}|${noteId}` },
    now,
    {
      refusal: () =>
        'Dieser Zettel wurde von hier aus gerade schon gemeldet. Die Verantwortlichen sind informiert.',
    },
  )
}

// Counted in the transaction that stores the report, so a report that is
// rolled back — the note is gone — gives the board's budget back
export function allowBoardReport(boardKey: string, now: Date, on: Executor) {
  return allowReportWithin(REPORT_BOARD_BUDGETS, { board: boardKey }, now, {
    on,
    events: { allowed: 'report:allowed', limited: 'report:board-limited' },
  })
}

// A report that also goes to the operator (a notice of illegal content):
// counted for the note and for the board under the Kita's current link, in
// the transaction that files it. Refused, nothing of the report is kept; it
// can go to the Kita alone, and the operator has had the note already.
export function allowOperatorReport(
  noteId: string,
  boardKey: string,
  operatorEmail: string,
  now: Date,
  on: Executor,
) {
  return allowReportWithin(
    REPORT_OPERATOR_BUDGETS,
    { note: noteId, board: boardKey },
    now,
    {
      on,
      events: { limited: 'report:operator-limited' },
      // Names the address, so a notice still reaches the operator when
      // others have used up the budget of the note
      refusal: () =>
        `Zu diesem Zettel oder Brett sind heute schon viele Meldungen beim Betreiber eingegangen. Du kannst den Zettel ohne diese Option der Kita melden oder dem Betreiber direkt an ${operatorEmail} schreiben.`,
    },
  )
}

// Whether the remarks of a report are new for this note: the same text
// (normalised like a note's) within the duplicate window is stored once, so
// a case doesn't fill up with copies. In the caller's transaction; the
// fingerprint goes with the note like the one of its text. Empty remarks
// have nothing to compare and are always new.
export async function claimReportRemarks(
  noteId: string,
  remarks: string,
  now: Date,
  on: Executor,
) {
  const fresh = await claimFreshContent(
    `report|${noteId}`,
    [remarks],
    noteId,
    now,
    on,
  )
  if (!fresh) countSpamEvent('report:duplicate')
  return fresh
}
