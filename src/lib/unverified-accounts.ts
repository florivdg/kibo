import { and, eq, lt, notExists } from 'drizzle-orm'

import { db } from '@/db'
import { member, user } from '@/db/schema'
import { errorMessage } from '@/lib/error-message'

// Better Auth's confirmation link is valid for an hour and can be sent again;
// a week is plenty of time for anyone who meant to sign up
export const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Sign-ups whose address was never confirmed. Their owners can't sign in, and
// while they exist the address can't be registered again by its real owner.
// Only accounts without any Kita: one with a membership has been in use and
// is left to its admin. Sessions and credentials go with the user row through
// their foreign keys. Called on the server's hourly timer
// (src/lib/server/runtime.ts).
export async function purgeUnverifiedAccounts(now: Date) {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_MS)
  const memberships = db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, user.id))
  try {
    await db
      .delete(user)
      .where(
        and(
          eq(user.emailVerified, false),
          lt(user.createdAt, cutoff),
          notExists(memberships),
        ),
      )
  } catch (error) {
    console.error(
      `[auth] Löschen unbestätigter Konten fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
