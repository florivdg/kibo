import { and, eq, inArray, isNotNull, lt, notExists, or } from 'drizzle-orm'

import { db } from '@/db'
import { account, member, passkey, user } from '@/db/schema'
import { errorMessage } from '@/lib/error-message'

// Better Auth's confirmation link is valid for an hour and can be sent again;
// a week is plenty of time for anyone who meant to sign up
export const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Sign-ups nobody finished, a week on: accounts whose address was never
// confirmed (they block the address for its real owner), and confirmed ones
// that never got a password or passkey (src/lib/password-setup.ts), counted
// from the row's last change so a recent confirmation isn't cut short. Only
// accounts without any Kita; sessions and credentials go with the user row.
// A row locked at that moment is skipped: whoever holds it (a reset, a
// confirmation, a new setup link — src/lib/password-setup.ts) is changing
// it, and the next run looks again. Called on the server's hourly timer
// (src/lib/server/runtime.ts).
export async function purgeUnverifiedAccounts(now: Date) {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_MS)
  const memberships = db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, user.id))
  const passwords = db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, user.id), isNotNull(account.password)))
  const passkeys = db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, user.id))
  const unfinished = db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        lt(user.createdAt, cutoff),
        notExists(memberships),
        or(
          eq(user.emailVerified, false),
          and(
            lt(user.updatedAt, cutoff),
            notExists(passwords),
            notExists(passkeys),
          ),
        ),
      ),
    )
    .for('update', { skipLocked: true })
  try {
    await db.delete(user).where(inArray(user.id, unfinished))
  } catch (error) {
    console.error(
      `[auth] Löschen unbestätigter Konten fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
