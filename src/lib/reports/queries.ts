import { and, asc, desc, eq, inArray, lte, or, type SQL } from 'drizzle-orm'

import { db } from '@/db'
import { board, noteReport, reportCase, user } from '@/db/schema'
import type { Executor } from '@/db/types'
import { BOARD_TYPES } from '@/lib/board/board-types'
import { addDays } from '@/lib/board/time'
import { errorMessage } from '@/lib/error-message'
import {
  REPORT_CLOSED_RETENTION_DAYS,
  REPORT_MAX_RETENTION_DAYS,
} from '@/lib/limits'

import type { ReportCaseStatus } from './types'

// What the admin pages read about reported notes (/admin/reports). Every
// read names the Kita: the page passes the active one, which the middleware
// has checked the user belongs to, and the page of one case switches to its
// Kita first (caseAccess in ./access.ts).

// The overview shows this many cases of each kind, the newest; it says so
// when there are more (`total`). Closing cases brings older open ones up,
// and every case goes after a while anyway (REPORT_*_RETENTION_DAYS).
const CASE_LIST_LIMIT = 200

// Whether the note still hangs on its board: not taken down, not run out
function stillHanging(
  row: { noteId: string | null; noteExpiresAt: Date },
  now: Date,
) {
  return row.noteId !== null && row.noteExpiresAt > now
}

// The cases of one kind for the overview, newest first, and how many of
// that kind there are in all
export async function listCases(
  organizationId: string,
  status: ReportCaseStatus,
  now: Date,
) {
  const ofKind = and(
    eq(reportCase.organizationId, organizationId),
    eq(reportCase.status, status),
  )
  const [rows, total] = await Promise.all([
    caseRows(ofKind, status),
    db.$count(reportCase, ofKind),
  ])
  return {
    cases: rows.map(({ noteId, noteExpiresAt, ...row }) => ({
      ...row,
      hanging: stillHanging({ noteId, noteExpiresAt }, now),
    })),
    total,
  }
}

function caseRows(ofKind: SQL | undefined, status: ReportCaseStatus) {
  return db
    .select({
      id: reportCase.id,
      noteTitle: reportCase.noteTitle,
      noteId: reportCase.noteId,
      noteExpiresAt: reportCase.noteExpiresAt,
      boardName: board.name,
      reportCount: reportCase.reportCount,
      firstReportedAt: reportCase.firstReportedAt,
      lastReportedAt: reportCase.lastReportedAt,
      closedAt: reportCase.closedAt,
      resolution: reportCase.resolution,
    })
    .from(reportCase)
    .innerJoin(board, eq(board.id, reportCase.boardId))
    .where(ofKind)
    .orderBy(
      status === 'open'
        ? desc(reportCase.lastReportedAt)
        : desc(reportCase.closedAt),
      desc(reportCase.id),
    )
    .limit(CASE_LIST_LIMIT)
}

// When the hourly run deletes a case (purgeReportCases below): a closed one
// some time after it was closed, any one some time after the first report —
// whichever comes first
function caseDeletesAt({
  closedAt,
  firstReportedAt,
}: {
  closedAt: Date | null
  firstReportedAt: Date
}) {
  const latest = addDays(firstReportedAt, REPORT_MAX_RETENTION_DAYS)
  if (!closedAt) return latest
  const closed = addDays(closedAt, REPORT_CLOSED_RETENTION_DAYS)
  return closed < latest ? closed : latest
}

export type CaseSummary = Awaited<ReturnType<typeof listCases>>['cases'][number]

// One case of the Kita with its reports, oldest first; undefined for a case
// of another Kita or none at all
export async function findCase(
  organizationId: string,
  caseId: string,
  now: Date,
) {
  const [found] = await db
    .select({
      row: reportCase,
      boardName: board.name,
      boardType: board.type,
      closedByName: user.name,
    })
    .from(reportCase)
    .innerJoin(board, eq(board.id, reportCase.boardId))
    .leftJoin(user, eq(user.id, reportCase.closedBy))
    .where(
      and(
        eq(reportCase.id, caseId),
        eq(reportCase.organizationId, organizationId),
      ),
    )
  if (!found) return undefined
  const reports = await db
    .select({
      id: noteReport.id,
      reason: noteReport.reason,
      remarks: noteReport.remarks,
      createdAt: noteReport.createdAt,
    })
    .from(noteReport)
    .where(eq(noteReport.caseId, caseId))
    .orderBy(asc(noteReport.createdAt), asc(noteReport.id))
  const { row, boardName, boardType, closedByName } = found
  const category = BOARD_TYPES[boardType].categories.find(
    ({ id }) => id === row.noteCategoryId,
  )
  return {
    ...row,
    boardName,
    categoryLabel: category?.label ?? row.noteCategoryId,
    closedByName,
    hanging: stillHanging(row, now),
    deletesAt: caseDeletesAt(row),
    reports,
  }
}

// How many cases of the Kita wait for someone, for the count next to
// „Meldungen“ in the sidebar (src/layouts/Admin.astro)
export function openCaseCount(organizationId: string) {
  return db.$count(
    reportCase,
    and(
      eq(reportCase.organizationId, organizationId),
      eq(reportCase.status, 'open'),
    ),
  )
}

interface PurgeOptions {
  // A transaction in the tests
  on?: Executor
  // Only the cases of these Kitas
  only?: string[]
}

// Cases are kept for a fixed time and then deleted with their reports and
// mails: a closed one REPORT_CLOSED_RETENTION_DAYS after it was closed, any
// one — open or not, with its copy of the note — REPORT_MAX_RETENTION_DAYS
// after the first report. Called by the server's hourly run
// (src/lib/server/runtime.ts), which logs and carries on.
export async function purgeReportCases(
  now: Date,
  { on = db, only }: PurgeOptions = {},
) {
  try {
    const deleted = await on
      .delete(reportCase)
      .where(
        and(
          or(
            lte(
              reportCase.closedAt,
              addDays(now, -REPORT_CLOSED_RETENTION_DAYS),
            ),
            lte(
              reportCase.firstReportedAt,
              addDays(now, -REPORT_MAX_RETENTION_DAYS),
            ),
          ),
          only && inArray(reportCase.organizationId, only),
        ),
      )
      .returning({ id: reportCase.id })
    if (deleted.length) {
      console.info(`[reports] ${deleted.length} alte Meldungsfälle gelöscht`)
    }
    return deleted.length
  } catch (error) {
    console.error(
      `[reports] Löschen alter Meldungen fehlgeschlagen: ${errorMessage(error)}`,
    )
    return 0
  }
}
