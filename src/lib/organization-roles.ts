import { createAccessControl } from 'better-auth/plugins/access'
import {
  defaultStatements,
  ownerAc,
} from 'better-auth/plugins/organization/access'

// Who may do what in a Kita. Two roles: whoever creates the Kita owns it,
// everyone they invite is an admin. Both manage boards and notes — the
// `boards.*` actions only ask for a membership. What is listed here is the
// Kita itself: only the owner renames it, invites, withdraws invitations and
// removes members. Better Auth's own `admin` role may do all of that, which is
// why Kibo brings its own.
//
// Loaded by the schema generator through auth-options.ts, so nothing here may
// use the @/ alias or server code.
export const OWNER_ROLE = 'owner'
export const ADMIN_ROLE = 'admin'

export const ac = createAccessControl(defaultStatements)

export const roles = {
  [OWNER_ROLE]: ownerAc,
  [ADMIN_ROLE]: ac.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ['read'],
  }),
}

// Whether a member with this role may invite, by the table above: what the
// plugin asks before /organization/invite-member creates an invitation. A
// member has exactly one role — nothing in Kibo changes it or writes several.
export function mayInvite(role: string) {
  if (!Object.hasOwn(roles, role)) return false
  return roles[role as keyof typeof roles].authorize({
    invitation: ['create'],
  }).success
}
