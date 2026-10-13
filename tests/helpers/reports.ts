import type { ActionAPIContext } from 'astro:actions'
import { asc, eq } from 'drizzle-orm'

import { notes } from '@/actions/notes'
import { noteReport, reportCase, reportNotification } from '@/db/schema'
import type { BoardLink } from '@/lib/board/types'
import { reportMailer } from '@/lib/reports/outbox'
import type { ReportReason } from '@/lib/reports/types'

import { visitorContext } from './actions'
import { testDb } from './spam-db'

// Reported notes (src/lib/reports/) for the tests: reports the way a visitor
// files them, and what the tables hold afterwards. The app's outbox runner
// is stopped as soon as this is loaded — a report would otherwise send its
// mails through the real mailer in the background — and the tests run the
// outbox themselves, on their own Kitas (dispatchReportMails with `only`).
reportMailer.stop()

let visitors = 0

// A network of its own for every report, so no budget is in the way unless
// a test means it to be
function nextVisitor() {
  visitors += 1
  return visitorContext(`198.51.100.${visitors % 250}`)
}

export function fileTestReport(
  link: BoardLink,
  noteId: string,
  {
    reason = 'spam',
    remarks = '',
    website = '',
    context = nextVisitor(),
  }: {
    reason?: ReportReason
    remarks?: string
    website?: string
    context?: ActionAPIContext
  } = {},
) {
  return notes.report.orThrow.call(context, {
    ...link,
    noteId,
    reason,
    remarks,
    website,
  })
}

export function casesOf(organizationId: string) {
  return testDb
    .select()
    .from(reportCase)
    .where(eq(reportCase.organizationId, organizationId))
    .orderBy(asc(reportCase.firstReportedAt), asc(reportCase.id))
}

export function reportsOf(caseId: string) {
  return testDb
    .select()
    .from(noteReport)
    .where(eq(noteReport.caseId, caseId))
    .orderBy(asc(noteReport.createdAt), asc(noteReport.id))
}

export function notificationsOf(organizationId: string) {
  return testDb
    .select()
    .from(reportNotification)
    .where(eq(reportNotification.organizationId, organizationId))
    .orderBy(asc(reportNotification.userId), asc(reportNotification.caseId))
}
