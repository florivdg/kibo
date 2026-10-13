import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { member, reportCase } from '@/db/schema'
import { memberRole } from '@/lib/organization-access'
import { ADMIN_ROLE, OWNER_ROLE } from '@/lib/organization-roles'

// Who handles the reports of a Kita: every current member with the role of
// owner or admin — the two roles Kibo knows. Asked by the reports.* actions,
// the admin pages and, at the moment a mail goes out, the outbox.
const REPORT_HANDLER_ROLES: readonly string[] = [OWNER_ROLE, ADMIN_ROLE]

// The member rows of those, for the queries that join them
export function handlesReports() {
  return inArray(member.role, [...REPORT_HANDLER_ROLES])
}

export async function mayHandleReports(organizationId: string, userId: string) {
  const role = await memberRole(organizationId, userId)
  return role !== undefined && REPORT_HANDLER_ROLES.includes(role)
}

// What the page of one case does for whoever opens it — mostly from the link
// in a mail, which may name a case of another Kita than the active one:
// show it, switch to its Kita first (the user handles reports there), or
// answer like an address that doesn't exist. A case that doesn't exist and
// one of a Kita the user has nothing to do with look the same.
export type CaseAccess =
  | { kind: 'show' }
  | { kind: 'switch'; organizationId: string }
  | { kind: 'none' }

export async function caseAccess(
  caseId: string,
  userId: string,
  activeOrganizationId: string | undefined,
): Promise<CaseAccess> {
  const [found] = await db
    .select({ organizationId: reportCase.organizationId })
    .from(reportCase)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, reportCase.organizationId),
        eq(member.userId, userId),
      ),
    )
    .where(and(eq(reportCase.id, caseId), handlesReports()))
    .limit(1)
  if (!found) return { kind: 'none' }
  return found.organizationId === activeOrganizationId
    ? { kind: 'show' }
    : { kind: 'switch', organizationId: found.organizationId }
}

// The same for the overview, which the mail about several cases opens with
// the Kita it is about (reportsPath in ./paths.ts)
export async function kitaAccess(
  organizationId: string,
  userId: string,
  activeOrganizationId: string | undefined,
): Promise<CaseAccess> {
  if (organizationId === activeOrganizationId) return { kind: 'show' }
  return (await mayHandleReports(organizationId, userId))
    ? { kind: 'switch', organizationId }
    : { kind: 'none' }
}
