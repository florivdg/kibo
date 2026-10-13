import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { board, kitaLink } from '@/db/schema'
import { pushDispatcher } from '@/lib/push/dispatcher'
import { deleteBoardSubscriptions } from '@/lib/push/subscriptions'

import { organizationBoard } from './queries'
import { newLinkToken } from './secrets'

// Admin changes that reach beyond the board row, as plain functions so the
// tests can run them; src/actions/boards.ts checks the session and calls them.
// The board functions return the rows they changed: none when the board isn't
// one of the Kita's.

// Changes the board and, where that revokes its notifications, drops the
// subscriptions in the same transaction. Once that is committed, a
// notification still waiting to go out is dropped too, and a fan-out under
// way sends nothing more.
async function changeBoard(
  organizationId: string,
  boardId: string,
  values: Partial<typeof board.$inferInsert>,
  revokesPush: boolean,
) {
  const changed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(board)
      .set(values)
      .where(organizationBoard(organizationId, boardId))
      .returning({ id: board.id })
    if (rows.length && revokesPush) await deleteBoardSubscriptions(boardId, tx)
    return rows
  })
  if (changed.length && revokesPush) pushDispatcher.cancel(boardId)
  return changed
}

// A new Kita link locks out everyone who only had the old one: every board
// link, QR code and installed app of the Kita, and every notification — the
// subscriptions of all its boards go in the same transaction. The token is
// written first, so a subscription being added under the old link
// (src/lib/push/subscriptions.ts, which locks the Kita link's row) either
// waits and then finds nothing, or is done before and deleted here. After the
// commit every board's pending notification is dropped, whether the board had
// subscribers or not: a batch of notes from before the renewal must not reach
// someone who subscribes with the new link while it waits. Notes stay.
// Returns the Kita's boards, all of them now without subscriptions.
export async function renewKitaLink(organizationId: string) {
  const token = newLinkToken()
  const boardIds = await db.transaction(async (tx) => {
    await tx
      .insert(kitaLink)
      .values({ organizationId, token })
      .onConflictDoUpdate({ target: kitaLink.organizationId, set: { token } })
    const kitaBoards = await tx
      .select({ id: board.id })
      .from(board)
      .where(eq(board.organizationId, organizationId))
    const ids = kitaBoards.map((row) => row.id)
    if (ids.length) await deleteBoardSubscriptions(ids, tx)
    return ids
  })
  for (const boardId of boardIds) pushDispatcher.cancel(boardId)
  return boardIds
}

// Switched off, the bell disappears from the board and the existing
// subscriptions go: nobody keeps data around for notifications that can't
// come any more
export function setBoardPushEnabled(
  organizationId: string,
  boardId: string,
  enabled: boolean,
) {
  return changeBoard(
    organizationId,
    boardId,
    { pushEnabled: enabled },
    !enabled,
  )
}

// The subscriptions and notes go with the board (foreign keys), a pending
// notification with them
export async function deleteBoard(organizationId: string, boardId: string) {
  const deleted = await db
    .delete(board)
    .where(organizationBoard(organizationId, boardId))
    .returning({ id: board.id })
  if (deleted.length) pushDispatcher.cancel(boardId)
  return deleted
}
