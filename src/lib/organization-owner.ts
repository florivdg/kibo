import { eq } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { member } from '@/db/schema'
import { OWNER_ROLE } from '@/lib/organization-roles'

// The role of a member row is the owner's. Better Auth could store several
// roles comma-separated; Kibo never does — a member gets one role when they
// join, and changing it is switched off (src/lib/auth-options.ts). Takes
// `member` or an alias of it in a join. No `@/db` in here: scripts/admin.ts
// asks the same through src/lib/hosted/subscriptions.ts.
export function ownsOrganization(row: { role: AnyPgColumn } = member) {
  return eq(row.role, OWNER_ROLE)
}
