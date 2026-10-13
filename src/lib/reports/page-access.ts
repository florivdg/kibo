import { auth } from '@/lib/auth'

import type { CaseAccess } from './access'

// What a page of /admin/reports does with the answer of caseAccess or
// kitaAccess (./access.ts): render, or — for a Kita the user handles reports
// in but that isn't the active one — make it the active one and load the
// page afresh, so the sidebar, the notice and everything else are about the
// Kita the page shows. Better Auth checks the membership once more. `none`
// is for the page to answer like an address that doesn't exist.
export async function settleAccess(
  access: CaseAccess,
  request: Request,
): Promise<'show' | 'reload' | 'none'> {
  if (access.kind !== 'switch') return access.kind
  await auth.api.setActiveOrganization({
    headers: request.headers,
    body: { organizationId: access.organizationId },
  })
  return 'reload'
}
