// What a report of a note is made of, for the form on the board, the action
// that takes it, the admin pages and the schema alike. No imports: the schema
// generator loads this file (src/db/schema/report.ts).

// Why a visitor reports a note, in the order the form lists them
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam oder Werbung' },
  { id: 'offensive', label: 'Beleidigung oder unangemessener Inhalt' },
  { id: 'personal-data', label: 'Persönliche Daten' },
  { id: 'other', label: 'Sonstiges' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['id']

export const REPORT_REASON_IDS = REPORT_REASONS.map(({ id }) => id) as [
  ReportReason,
  ...ReportReason[],
]

export function reportReasonLabel(reason: ReportReason) {
  return REPORT_REASONS.find(({ id }) => id === reason)?.label ?? reason
}

// The optional "Weitere Hinweise"
export const REPORT_REMARKS_MAX = 500

// The optional name of whoever reports a note to the operator as well
// (src/lib/reports/operator-notice.ts)
export const REPORT_NOTIFIER_NAME_MAX = 120

export const REPORT_CASE_STATUSES = ['open', 'closed'] as const
export type ReportCaseStatus = (typeof REPORT_CASE_STATUSES)[number]

// How a case was closed: `removed` when closing it took the note down,
// `kept` otherwise — the note left hanging, or gone already by then
export const REPORT_RESOLUTIONS = ['removed', 'kept'] as const
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number]

// What a visitor sends
export interface ReportDraft {
  reason: ReportReason | ''
  remarks: string
  // Honeypot: hidden from people, bots tend to fill it in
  website: string
  // „Rechtswidriger Inhalt – auch an den Betreiber melden“, with what that
  // asks for: name and address optional, the statement of good faith not
  toOperator: boolean
  notifierName: string
  notifierEmail: string
  goodFaith: boolean
}

// What notes.report answers for a report that also went to the operator:
// whether the operator's mail went out, and the confirmation to the address
// the visitor gave (not without one, over its mail budget or when it failed)
export interface OperatorReportOutcome {
  operatorNotified: boolean
  receiptSent: boolean
}
