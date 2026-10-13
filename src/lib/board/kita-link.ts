import { and, eq, type SQL } from 'drizzle-orm'
import type { SelectedFields } from 'drizzle-orm/pg-core'

import { db } from '@/db'
import { board, kitaLink, organization } from '@/db/schema'
import type { Executor } from '@/db/types'
import { withSubscription } from '@/lib/hosted/access'

import { newLinkToken } from './secrets'
import type { BoardLink } from './types'

// The Kita link /k/<kitaToken>/ (the kita_link table): one secret for every
// board of a Kita. Whoever has it sees all of them; a board is addressed as
// the token plus the board's id, which is no secret on its own.
//
// The token's format (isLinkToken in ./secrets.ts) is checked by whoever
// looks a link up (src/lib/board/queries.ts, src/lib/push/subscriptions.ts,
// src/actions/notes.ts), once and before any query: a malformed token can't
// be a Kita and never reaches the database. The builders here take it as
// checked.

function readKitaLink(organizationId: string, on: Executor) {
  return on
    .select({ token: kitaLink.token, name: organization.name })
    .from(organization)
    .leftJoin(kitaLink, eq(kitaLink.organizationId, organization.id))
    .where(eq(organization.id, organizationId))
}

// The Kita's link and name, for the admin pages. Made the first time an
// admin page asks: nobody can know a token before then, and a renewal
// (renewKitaLink in ./mutations.ts) writes its own. Parallel first reads all
// get the one that won.
export async function kitaLinkOf(organizationId: string, on: Executor = db) {
  const [row] = await readKitaLink(organizationId, on)
  if (!row) throw new Error(`Kita ${organizationId} not found`)
  if (row.token) return { token: row.token, name: row.name }
  const [created] = await on
    .insert(kitaLink)
    .values({ organizationId, token: newLinkToken() })
    .onConflictDoNothing({ target: kitaLink.organizationId })
    .returning({ token: kitaLink.token })
  const [won] = created ? [created] : await readKitaLink(organizationId, on)
  if (!won?.token) throw new Error(`Kita ${organizationId} has no link`)
  return { token: won.token, name: row.name }
}

// Whom parents ask about data protection (./privacy-contact.ts), for the
// Kita's settings page: null for nobody, and for a Kita whose link no admin
// page has read yet
export async function privacyContactOf(organizationId: string) {
  const [row] = await db
    .select({ privacyContact: kitaLink.privacyContact })
    .from(kitaLink)
    .where(eq(kitaLink.organizationId, organizationId))
  return row?.privacyContact ?? null
}

// Stores it, already normalized; null takes it away. A Kita without a link
// gets one with it, as it would with the first admin page that reads it. A
// renewal (renewKitaLink in ./mutations.ts) only writes the token and leaves
// it as it is.
export async function setPrivacyContact(
  organizationId: string,
  privacyContact: string | null,
) {
  await db
    .insert(kitaLink)
    .values({ organizationId, token: newLinkToken(), privacyContact })
    .onConflictDoUpdate({
      target: kitaLink.organizationId,
      set: { privacyContact },
    })
}

// How a board and its Kita's link are joined; with a token, only the link
// that is this token. The token belongs in the join condition, not in the
// WHERE: a caller that locks the rows (src/lib/push/subscriptions.ts) has it
// checked again against the version a renewal it waited for left behind.
export function kitaLinkOn(kitaToken?: string) {
  return and(
    eq(kitaLink.organizationId, board.organizationId),
    kitaToken === undefined ? undefined : eq(kitaLink.token, kitaToken),
  )
}

// The chosen columns of the board behind a link, with the subscription of
// its Kita's owner (src/lib/hosted/access.ts), unfinished like
// withSubscription. A board of another Kita finds nothing, like an unknown
// one.
export function linkedBoard<T extends SelectedFields>(
  columns: T,
  { kitaToken, boardId }: BoardLink,
  on: Executor = db,
) {
  return withSubscription(board, columns, eq(board.id, boardId), on).innerJoin(
    kitaLink,
    kitaLinkOn(kitaToken),
  )
}

// The ids of the boards behind a Kita token that `where` picks, as a
// subquery for a statement that writes and checks the link itself
export function linkedBoardIds(kitaToken: string, where?: SQL) {
  return db
    .select({ id: board.id })
    .from(board)
    .innerJoin(kitaLink, kitaLinkOn(kitaToken))
    .where(where)
}

// What the spam budgets of a board are counted for (src/lib/spam/guard.ts):
// the board under the Kita's current link, so a renewed link starts with a
// fresh budget — an attack ends without leaving the board shut for the day
export function boardBudgetKey({ kitaToken, boardId }: BoardLink) {
  return `${kitaToken}|${boardId}`
}

// The same for the budgets of all boards of a Kita together: its current
// link, so renewing it resets them as well
export function kitaBudgetKey(kitaToken: string) {
  return kitaToken
}
