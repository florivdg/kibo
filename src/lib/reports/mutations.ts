import { and, count, eq, gt, sql, TransactionRollbackError } from 'drizzle-orm'

import { db } from '@/db'
import {
  member,
  note,
  noteReport,
  reportCase,
  reportNotification,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { REPORTS_PER_CASE_MAX } from '@/lib/limits'
import { claimReportRemarks } from '@/lib/spam/guard'

import { handlesReports } from './access'
import { deleteNote } from './takedown'
import type { ReportReason, ReportResolution } from './types'

// What changes reports: a visitor files one (notes.report), an admin closes a
// case (reports.close). Plain functions on the caller's transaction or the
// pool, so the tests can run them; the actions check who asks.

// The note being reported, as the server has it: on this board and still
// hanging. Locked against deletion until the report is stored, so the case
// can't point at a note that went in between.
export async function reportedNote(
  on: Executor,
  boardId: string,
  noteId: string,
  now: Date,
) {
  const [found] = await on
    .select({
      id: note.id,
      categoryId: note.categoryId,
      title: note.title,
      body: note.body,
      author: note.author,
      contact: note.contact,
      createdAt: note.createdAt,
      expiresAt: note.expiresAt,
    })
    .from(note)
    .where(
      and(
        eq(note.id, noteId),
        eq(note.boardId, boardId),
        gt(note.expiresAt, now),
      ),
    )
    .for('key share')
  return found
}

export type ReportedNote = NonNullable<Awaited<ReturnType<typeof reportedNote>>>

// The note's open case with one more report, or a new case with the copy of
// the note. One statement: of two reports arriving at once, one creates the
// case and the other counts on it (the unique index on open cases per note).
// `created` tells the two apart — Postgres sets xmax only on a row the
// statement updated.
async function caseFor(
  on: Executor,
  organizationId: string,
  boardId: string,
  reported: ReportedNote,
  now: Date,
) {
  const [row] = await on
    .insert(reportCase)
    .values({
      organizationId,
      boardId,
      noteId: reported.id,
      noteCategoryId: reported.categoryId,
      noteTitle: reported.title,
      noteBody: reported.body,
      noteAuthor: reported.author,
      noteContact: reported.contact,
      noteCreatedAt: reported.createdAt,
      noteExpiresAt: reported.expiresAt,
      firstReportedAt: now,
      lastReportedAt: now,
    })
    .onConflictDoUpdate({
      target: reportCase.noteId,
      targetWhere: sql`${reportCase.status} = 'open'`,
      set: {
        reportCount: sql`${reportCase.reportCount} + 1`,
        lastReportedAt: now,
      },
    })
    .returning({ id: reportCase.id, created: sql<boolean>`(xmax = 0)` })
  return row!
}

// The reason and remarks are kept for the first REPORTS_PER_CASE_MAX
// reports; remarks only when they say something the note was not told yet
// within the duplicate window (claimReportRemarks)
async function keepReport(
  on: Executor,
  caseId: string,
  noteId: string,
  { reason, remarks }: { reason: ReportReason; remarks: string },
  now: Date,
) {
  const [kept] = await on
    .select({ total: count() })
    .from(noteReport)
    .where(eq(noteReport.caseId, caseId))
  if ((kept?.total ?? 0) >= REPORTS_PER_CASE_MAX) return
  const fresh = await claimReportRemarks(noteId, remarks, now, on)
  await on.insert(noteReport).values({
    caseId,
    reason,
    remarks: fresh ? remarks : '',
    createdAt: now,
  })
}

// The mails about a new case: one row for every owner and admin the Kita has
// right now, worked off after the commit (./outbox.ts), which asks once more
// whether the recipient still belongs to the Kita
async function queueNotifications(
  on: Executor,
  organizationId: string,
  caseId: string,
  now: Date,
) {
  const recipients = await on
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), handlesReports()))
  if (!recipients.length) return
  await on
    .insert(reportNotification)
    .values(
      recipients.map(({ userId }) => ({
        caseId,
        organizationId,
        userId,
        nextAttemptAt: now,
        createdAt: now,
      })),
    )
    .onConflictDoNothing()
}

// Files a report in the caller's transaction: on the note's open case, or on
// a new one together with its mails. Only a new case is mailed about —
// further reports of an open case count on it quietly.
export async function fileReport(
  on: Executor,
  target: { organizationId: string; boardId: string },
  reported: ReportedNote,
  report: { reason: ReportReason; remarks: string },
  now: Date,
) {
  const { id, created } = await caseFor(
    on,
    target.organizationId,
    target.boardId,
    reported,
    now,
  )
  await keepReport(on, id, reported.id, report, now)
  if (created) await queueNotifications(on, target.organizationId, id, now)
  return { caseId: id, created }
}

// Closes an open case of the Kita, with the note taken down in the same
// transaction or left where it is. A note that is gone already — taken down,
// expired — doesn't stand in the way; the case then says `kept`, since
// nobody removed anything. Undefined when the Kita has no such open case
// (another Kita's, closed already, unknown).
//
// Lock order: the note before the case, as in notes.report, which holds the
// note (reportedNote, FOR KEY SHARE) while it counts on the open case. The
// case is only read here at first; deleting the note locks it FOR UPDATE,
// which waits for reports under way and holds off new ones, and only then is
// the case changed. Done the other way round, a report and a close of the same note
// could each wait for the other's lock until Postgres aborts one of them. A
// report that waited for the note finds it gone and reports nothing.
export async function closeCase(
  organizationId: string,
  caseId: string,
  closing: { userId: string; removeNote: boolean },
  now: Date,
) {
  const openCase = and(
    eq(reportCase.id, caseId),
    eq(reportCase.organizationId, organizationId),
    eq(reportCase.status, 'open'),
  )
  try {
    return await db.transaction(async (tx) => {
      const [found] = await tx
        .select({ noteId: reportCase.noteId, boardId: reportCase.boardId })
        .from(reportCase)
        .where(openCase)
      if (!found) return undefined
      const noteRemoved =
        closing.removeNote && found.noteId
          ? await deleteNote(tx, found.noteId, found.boardId)
          : false
      const resolution: ReportResolution = noteRemoved ? 'removed' : 'kept'
      const [closed] = await tx
        .update(reportCase)
        .set({
          status: 'closed',
          closedAt: now,
          closedBy: closing.userId,
          resolution,
        })
        .where(openCase)
        .returning({ id: reportCase.id })
      // Closed by someone else of the team in between: the note stays
      if (!closed) tx.rollback()
      return { resolution, noteRemoved }
    })
  } catch (error) {
    if (error instanceof TransactionRollbackError) return undefined
    throw error
  }
}
