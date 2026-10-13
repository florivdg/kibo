import { and, desc, eq } from 'drizzle-orm'

import { board, note, organization, reportCase } from '@/db/schema'
import type { Database, Executor } from '@/db/types'

// Taking a reported note down: by the Kita, closing its case
// (closeCase in ./mutations.ts), or by the operator, who has no account in
// the Kita and acts on a notice of illegal content with scripts/admin.ts
// (remove-note). Without `@/db` — the operator's script uses this file and
// must not load `astro:env` — so every function takes its executor.

// Takes the note down, if it still hangs on that board. The DELETE takes the
// row's FOR UPDATE lock itself (waiting for reports under way). Whether it
// was there to take down.
export async function deleteNote(
  on: Executor,
  noteId: string,
  boardId: string,
) {
  const removed = await on
    .delete(note)
    .where(and(eq(note.id, noteId), eq(note.boardId, boardId)))
    .returning({ id: note.id })
  return removed.length > 0
}

// What became of the note's report case when the operator took it down: its
// open case closed, the newest case the Kita had closed (keeping the note)
// re-marked, or none there
export type OperatorTakedownCase = 'closed' | 'updated' | 'none'

// Records the operator's decision on the note's case: the open one if there
// is one, else the newest one the Kita closed — it kept the note, or the
// note would be gone —, so the Kita sees under „Meldungen“ that the operator
// took it down after all. Both as `removed`, `closedByOperator`, nobody's
// account.
async function recordOperatorRemoval(
  tx: Executor,
  noteId: string,
  now: Date,
): Promise<OperatorTakedownCase> {
  const removal = {
    status: 'closed',
    closedAt: now,
    closedBy: null,
    closedByOperator: true,
    resolution: 'removed',
  } as const
  const closed = await tx
    .update(reportCase)
    .set(removal)
    .where(and(eq(reportCase.noteId, noteId), eq(reportCase.status, 'open')))
    .returning({ id: reportCase.id })
  if (closed.length > 0) return 'closed'
  const [newest] = await tx
    .select({ id: reportCase.id })
    .from(reportCase)
    .where(and(eq(reportCase.noteId, noteId), eq(reportCase.status, 'closed')))
    .orderBy(desc(reportCase.closedAt))
    .limit(1)
  if (!newest) return 'none'
  await tx.update(reportCase).set(removal).where(eq(reportCase.id, newest.id))
  return 'updated'
}

// The operator takes a note down by its id, whatever board it hangs on, and
// records that on its case (recordOperatorRemoval). Undefined when there is
// no such note — taken down already, or purged after it ran out.
//
// Lock order as in closeCase: the note first (FOR UPDATE, which waits for
// reports under way and holds off new ones, so no case can open behind this
// one's back), then the case. The case is written before the note goes,
// because deleting the note empties the case's `noteId`.
export function removeNoteAsOperator(db: Database, noteId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        id: note.id,
        title: note.title,
        boardId: note.boardId,
        boardName: board.name,
        kitaName: organization.name,
      })
      .from(note)
      .innerJoin(board, eq(board.id, note.boardId))
      .innerJoin(organization, eq(organization.id, board.organizationId))
      .where(eq(note.id, noteId))
      .for('update', { of: note })
    if (!found) return undefined
    const outcome = await recordOperatorRemoval(tx, noteId, now)
    await deleteNote(tx, found.id, found.boardId)
    return { ...found, reportCase: outcome }
  })
}
