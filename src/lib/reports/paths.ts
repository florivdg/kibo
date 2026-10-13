// Where the reports of a Kita are handled in the admin area. The mails link
// here (./outbox.ts); both pages switch to the Kita they name when another
// one is active and the user handles reports there.
export const REPORTS_PATH = '/admin/reports'

// The query parameter of the overview that names the Kita
export const REPORTS_KITA_PARAM = 'kita'

export function reportCasePath(caseId: string) {
  return `${REPORTS_PATH}/${encodeURIComponent(caseId)}`
}

export function reportsPath(organizationId: string) {
  return `${REPORTS_PATH}?${REPORTS_KITA_PARAM}=${encodeURIComponent(organizationId)}`
}
