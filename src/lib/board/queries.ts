import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  lte,
  max,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import type { SelectedFields } from 'drizzle-orm/pg-core'

import { db } from '@/db'
import {
  board,
  kitaLink,
  note,
  organization,
  pushSubscription,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { errorMessage } from '@/lib/error-message'
import { isPausedOn, withSubscription } from '@/lib/hosted/access'
import { instanceMode } from '@/lib/instance'
import { vapidConfig } from '@/lib/push/config'

import { BOARD_TYPES } from './board-types'
import { linkedBoard, linkedBoardIds } from './kita-link'
import { privacyContactLink, type KitaResponsibility } from './privacy-contact'
import { isLinkToken } from './secrets'
import type { Board, BoardLink, KitaBoard, Note, NoteCursor } from './types'

// Everything a visitor may see; never the delete key hash
export const publicNoteColumns = {
  id: note.id,
  categoryId: note.categoryId,
  title: note.title,
  body: note.body,
  author: note.author,
  contact: note.contact,
  createdAt: note.createdAt,
  expiresAt: note.expiresAt,
}

type NoteRow = Pick<typeof note.$inferSelect, keyof typeof publicNoteColumns>

export function toNote({ contact, createdAt, expiresAt, ...row }: NoteRow) {
  return {
    ...row,
    contact: contact ?? undefined,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  } satisfies Note
}

// A spammed board must not turn into one huge response. Notes are read one
// page at a time, newest first; the rest stays reachable through the cursor.
export const NOTE_PAGE_SIZE = 40

// Keyset paging on (createdAt, id): a stable order even for notes pinned in
// the same second, and no page shifts when older notes expire in between.
function olderThan(cursor: NoteCursor) {
  return sql`(${note.createdAt}, ${note.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`
}

export async function notePage(
  boardId: string,
  now: Date,
  cursor?: NoteCursor,
) {
  const rows = await db
    .select(publicNoteColumns)
    .from(note)
    .where(
      and(
        eq(note.boardId, boardId),
        gt(note.expiresAt, now),
        cursor ? olderThan(cursor) : undefined,
      ),
    )
    .orderBy(desc(note.createdAt), desc(note.id))
    .limit(NOTE_PAGE_SIZE + 1)

  const hasMore = rows.length > NOTE_PAGE_SIZE
  return {
    notes: rows.slice(0, NOTE_PAGE_SIZE).map(toNote),
    hasMore,
  }
}

// The VAPID public key a visitor's browser subscribes with, or null when the
// instance has no push configured. Read at request time, so the image stays
// the same for every domain.
function pushPublicKey() {
  return vapidConfig()?.publicKey ?? null
}

// Who answers for the boards of a Kita, for the foot of every page of its
// link (LegalFooter.astro): on the hosted instance the Kita itself — the
// operator only processes on its behalf —, with whom to ask about data
// protection where the owner said. Undefined on a self-hosted instance,
// whose operator is usually the Träger and says so in the privacy policy.
function kitaResponsibility(
  kitaName: string,
  privacyContact: string | null,
): KitaResponsibility | undefined {
  if (!instanceMode.hosted) return undefined
  return {
    kitaName,
    contact: privacyContact ? privacyContactLink(privacyContact) : undefined,
  }
}

// Board and its current notes for the public page, by Kita link and board
// id. A board of a Kita the hosted instance has paused comes back as just
// that, with the two names and who answers for it, nothing else: its notes
// aren't even read.
// Whether it is paused comes with the board (src/lib/hosted/access.ts). A
// malformed link can't be a board and never reaches the database.
export async function findPublicBoard(link: BoardLink, now: Date) {
  if (!isLinkToken(link.kitaToken)) return undefined
  const [row] = await linkedBoard(
    {
      id: board.id,
      type: board.type,
      name: board.name,
      description: board.description,
      kitaName: organization.name,
      pushEnabled: board.pushEnabled,
      privacyContact: kitaLink.privacyContact,
    },
    link,
  ).innerJoin(organization, eq(board.organizationId, organization.id))
  if (!row) return undefined

  const { type, pushEnabled, subscription, privacyContact, ...rest } = row
  const responsible = kitaResponsibility(rest.kitaName, privacyContact)
  if (isPausedOn(subscription, now)) {
    const { name, kitaName } = rest
    return { paused: true as const, board: { name, kitaName }, responsible }
  }
  const { categories, hints } = BOARD_TYPES[type]
  return {
    paused: false as const,
    responsible,
    board: {
      ...rest,
      kitaToken: link.kitaToken,
      categories,
      hints,
      pushPublicKey: pushEnabled ? pushPublicKey() : null,
    } satisfies Board,
    ...(await notePage(rest.id, now)),
  }
}

// The board behind a link, for the public actions. A malformed link can't be
// a board and never reaches the database. `paused`: whether the hosted
// instance has paused its Kita, read in the same statement
// (src/lib/hosted/access.ts).
export async function findLinkedBoard(link: BoardLink, now = new Date()) {
  if (!isLinkToken(link.kitaToken)) return undefined
  const [row] = await linkedBoard(
    {
      id: board.id,
      organizationId: board.organizationId,
      type: board.type,
      name: board.name,
      pushEnabled: board.pushEnabled,
    },
    link,
  )
  if (!row) return undefined
  const { subscription, ...found } = row
  return { ...found, paused: isPausedOn(subscription, now) }
}

// The Kita behind a well-formed token: its id, name and privacy contact, and
// whether the hosted instance has paused it, in one statement
async function kitaByToken(kitaToken: string, now: Date) {
  const [row] = await withSubscription(
    kitaLink,
    {
      organizationId: kitaLink.organizationId,
      name: organization.name,
      privacyContact: kitaLink.privacyContact,
    },
    eq(kitaLink.token, kitaToken),
  ).innerJoin(organization, eq(kitaLink.organizationId, organization.id))
  if (!row) return undefined
  const { subscription, ...found } = row
  return { ...found, paused: isPausedOn(subscription, now) }
}

// The Kita behind a link. Undefined for a malformed or unknown token — the
// link of before a renewal included.
export function findKita(kitaToken: string, now = new Date()) {
  return isLinkToken(kitaToken)
    ? kitaByToken(kitaToken, now)
    : Promise.resolve(undefined)
}

// What the board page (src/pages/k/[kita]/[board].astro) shows: the board,
// paused or not; for a board that isn't (any more) one of the Kita's, the
// Kita — so the page can lead to its other boards, or say that they are all
// paused. Undefined for a link that leads nowhere. The Kita is only looked up
// when the board isn't found.
export async function findBoardPage(link: BoardLink, now: Date) {
  const found = await findPublicBoard(link, now)
  if (found?.paused) return { kind: 'paused-board' as const, ...found }
  if (found) return { kind: 'board' as const, ...found }
  const kita = await findKita(link.kitaToken, now)
  if (!kita) return undefined
  const named = {
    kita: { name: kita.name },
    responsible: kitaResponsibility(kita.name, kita.privacyContact),
  }
  return kita.paused
    ? { kind: 'paused-kita' as const, ...named }
    : { kind: 'unknown-board' as const, ...named }
}

// The boards `where` picks with the chosen columns and the number of their
// current notes, oldest board first: the admin list and the Kita page
function boardsWithNoteCount<T extends SelectedFields>(
  columns: T,
  where: SQL,
  now: Date,
) {
  return db
    .select({ ...columns, noteCount: count(note.id) })
    .from(board)
    .leftJoin(note, and(eq(note.boardId, board.id), gt(note.expiresAt, now)))
    .where(where)
    .groupBy(board.id)
    .orderBy(board.createdAt, board.id)
}

// The Kita page: every board with what its card shows — never more than a
// visitor sees on the board itself. `latestNoteAt` is the newest current
// note, for the „Neu“ marker the browser works out against its last visit.
// The Kita and its boards are read side by side, both by the token; the
// boards of a paused Kita are dropped unseen.
export async function findPublicKita(kitaToken: string, now: Date) {
  if (!isLinkToken(kitaToken)) return undefined
  const [kita, rows] = await Promise.all([
    kitaByToken(kitaToken, now),
    boardsWithNoteCount(
      {
        id: board.id,
        name: board.name,
        description: board.description,
        pushEnabled: board.pushEnabled,
        latestNoteAt: max(note.createdAt),
      },
      inArray(board.id, linkedBoardIds(kitaToken)),
      now,
    ),
  ])
  if (!kita) return undefined
  const { name, paused } = kita
  const responsible = kitaResponsibility(name, kita.privacyContact)
  if (paused) return { paused: true as const, kita: { name }, responsible }
  return {
    paused: false as const,
    responsible,
    // No key, and so neither the install hint nor push.sync, when no board
    // of the Kita takes notifications
    kita: {
      token: kitaToken,
      name,
      pushPublicKey: rows.some((row) => row.pushEnabled)
        ? pushPublicKey()
        : null,
    },
    boards: rows.map(({ latestNoteAt, ...row }): KitaBoard => ({
      ...row,
      latestNoteAt: latestNoteAt?.toISOString() ?? null,
    })),
  }
}

// The name of a Kita the caller already knows the user belongs to (the
// middleware checks the active one on every admin request)
export async function findOrganizationName(organizationId: string) {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return row?.name
}

export function organizationBoard(organizationId: string, boardId: string) {
  return and(eq(board.id, boardId), eq(board.organizationId, organizationId))
}

// Browsers subscribed to a board's notifications: awaited for one board, or
// with board.id as a subquery of a select from board
export function subscriberCount(
  boardId: string | SQLWrapper = board.id,
  on: Executor = db,
) {
  return on.$count(pushSubscription, eq(pushSubscription.boardId, boardId))
}

export function listBoards(organizationId: string, now: Date) {
  return boardsWithNoteCount(
    {
      id: board.id,
      type: board.type,
      name: board.name,
      pushEnabled: board.pushEnabled,
      // A subquery rather than a join: joined, every subscriber would count
      // every note once more
      subscriberCount: subscriberCount(),
    },
    eq(board.organizationId, organizationId),
    now,
  )
}

export async function findOrganizationBoard(
  organizationId: string,
  boardId: string,
  now: Date,
) {
  const [found] = await db
    .select({ row: board, subscriberCount: subscriberCount() })
    .from(board)
    .where(organizationBoard(organizationId, boardId))
  if (!found) return undefined
  return {
    board: found.row,
    subscriberCount: found.subscriberCount,
    ...(await notePage(found.row.id, now)),
  }
}

// Expired notes are hidden from every read right away and deleted for good
// here. Called only by the server's hourly timer (src/lib/server/runtime.ts),
// which is the one scheduler — a request has no business doing housekeeping.
export async function purgeExpiredNotes(now: Date) {
  try {
    await db.delete(note).where(lte(note.expiresAt, now))
  } catch (error) {
    console.error(
      `[db] Löschen abgelaufener Zettel fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
