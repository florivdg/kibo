import { and, asc, desc, eq, gt, lt, ne, or } from 'drizzle-orm'

import { db } from '@/db'
import { invitation, member, organization, user } from '@/db/schema'
import { normalizeEmail } from '@/lib/email'
import { errorMessage } from '@/lib/error-message'

// Who manages a Kita and who has been asked to. Read here, on the server, by
// the pages that show it: Better Auth's routes for listing members and
// invitations stay switched off (src/lib/auth-options.ts).

const PENDING = 'pending'

// An invitation that can still be accepted at the given moment
function open(now: Date) {
  return and(eq(invitation.status, PENDING), gt(invitation.expiresAt, now))
}

// Everyone in the Kita, in the order they joined: the owner comes first
export function listMembers(organizationId: string) {
  return db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt), asc(member.id))
}

// The invitations of a Kita nobody has answered yet
export function listPendingInvitations(
  organizationId: string,
  now = new Date(),
) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), open(now)))
    .orderBy(asc(invitation.createdAt), asc(invitation.id))
}

// The invitation behind the link of an invitation mail, while it can still be
// accepted. The id is what the mail hands over: nothing here is ever looked up
// by address, so nobody can ask which addresses have been invited.
export async function findPendingInvitation(id: string, now = new Date()) {
  const [found] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(and(eq(invitation.id, id), open(now)))
    .limit(1)
  return found
}

// The newest invitation waiting for this address, or null. For someone who
// just signed in and has no Kita yet: their own address, from their session.
// Better Auth stores the invited address in lower case.
export async function pendingInvitationFor(email: string, now = new Date()) {
  const [found] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.email, normalizeEmail(email)), open(now)))
    .orderBy(desc(invitation.createdAt), desc(invitation.id))
    .limit(1)
  return found?.id ?? null
}

// Better Auth keeps every invitation: accepted, rejected, withdrawn and
// expired ones stay in the table for good. Each is the address of a person
// and of no further use once it is answered or over, so they go on the
// server's hourly timer (src/lib/server/runtime.ts).
export async function purgeInvitations(now: Date) {
  try {
    await db
      .delete(invitation)
      .where(or(lt(invitation.expiresAt, now), ne(invitation.status, PENDING)))
  } catch (error) {
    console.error(
      `[auth] Löschen erledigter Einladungen fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
