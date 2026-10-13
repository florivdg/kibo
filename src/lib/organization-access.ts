import { and, asc, count, eq, inArray, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { db } from '@/db'
import type { Executor } from '@/db/types'
import { member, organization } from '@/db/schema'
import { ownsOrganization } from '@/lib/organization-owner'

// The user's role in a Kita, or undefined without a membership
export async function memberRole(organizationId: string, userId: string) {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .limit(1)
  return membership?.role
}

export async function isMember(organizationId: string, userId: string) {
  return (await memberRole(organizationId, userId)) !== undefined
}

// The Kita the user joined first, or null without any membership
export async function firstOrganizationId(userId: string, on: Executor = db) {
  const [membership] = await on
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return membership?.organizationId ?? null
}

// How many Kitas the account created. This is what ORGANIZATION_LIMIT counts:
// a Kita someone was invited to is not theirs and doesn't use up the limit.
export async function countOwnedOrganizations(userId: string) {
  const [row] = await db
    .select({ owned: count() })
    .from(member)
    .where(and(eq(member.userId, userId), ownsOrganization()))
  return row?.owned ?? 0
}

// The Kitas that would go with the user's account — the ones they own — and
// how many other people manage each of them
export async function ownedOrganizations(userId: string) {
  const other = alias(member, 'other_member')
  return db
    .select({
      id: organization.id,
      name: organization.name,
      otherMembers: count(other.id),
    })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .leftJoin(
      other,
      and(eq(other.organizationId, organization.id), ne(other.userId, userId)),
    )
    .where(and(eq(member.userId, userId), ownsOrganization()))
    .groupBy(organization.id, organization.name)
    .orderBy(asc(organization.name))
}

// Kitas of accounts being deleted, from just before the deletion until just
// after it, by user id
const deletedUsersOrganizations = new Map<string, string[]>()

// Runs right before an account is deleted: notes which Kitas it owns, because
// afterwards its member rows are gone and nothing says so
export async function rememberOrganizationsOf(user: { id: string }) {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, user.id), ownsOrganization()))
  deletedUsersOrganizations.set(
    user.id,
    rows.map((row) => row.organizationId),
  )
}

// Runs after an account is gone, and with it its member rows. The Kitas it
// owned go too, whether or not admins are still in them: the owner is who
// answers for a Kita, and the account page said so before the deletion. Their
// boards and notes follow through the foreign keys (organization -> board ->
// note, plus member and invitation). A Kita the account only helped to manage
// stays; there, the member row was all there was to remove.
// Only the Kitas remembered before the deletion are touched, never "every
// Kita without an owner": a Kita somebody else is creating in this very
// moment has no member row yet either, and must not be swept away with it.
// After, not before: if this fails, a Kita without an owner is left behind.
// The other way round, a failed user deletion would leave an account whose
// Kitas are already gone.
export async function deleteOwnedOrganizations(user: { id: string }) {
  const ids = deletedUsersOrganizations.get(user.id) ?? []
  deletedUsersOrganizations.delete(user.id)
  if (!ids.length) return
  await db.delete(organization).where(inArray(organization.id, ids))
}
