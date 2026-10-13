import { describe, expect, test } from 'bun:test'

import {
  ADMIN_ROLE,
  mayInvite,
  OWNER_ROLE,
  roles,
} from '@/lib/organization-roles'

// What the organization plugin asks before each of its routes acts
const OWNER_ONLY: Record<string, string[]>[] = [
  { organization: ['update'] },
  { invitation: ['create'] },
  { invitation: ['cancel'] },
  { member: ['delete'] },
  { member: ['update'] },
  { organization: ['delete'] },
]

function may(role: keyof typeof roles, permission: Record<string, string[]>) {
  return roles[role].authorize(permission).success
}

describe('Kita roles', () => {
  test('the owner renames, invites, withdraws and removes', () => {
    for (const permission of OWNER_ONLY) {
      expect(may(OWNER_ROLE, permission)).toBe(true)
    }
  })

  // Better Auth's own admin role may do most of this; Kibo's may not
  test('an admin does none of that', () => {
    for (const permission of OWNER_ONLY) {
      expect(may(ADMIN_ROLE, permission)).toBe(false)
    }
  })

  test('there are no other roles', () => {
    expect(Object.keys(roles).sort()).toEqual([ADMIN_ROLE, OWNER_ROLE])
  })
})

// What the hook in front of /organization/invite-member asks (src/lib/auth.ts)
describe('mayInvite', () => {
  test('follows the role table', () => {
    expect(mayInvite(OWNER_ROLE)).toBe(true)
    expect(mayInvite(ADMIN_ROLE)).toBe(false)
  })

  test('knows no other role', () => {
    for (const role of ['member', 'co-owner', '', 'constructor']) {
      expect(mayInvite(role)).toBe(false)
    }
  })
})
