import { generateId } from '@better-auth/core/utils/id'
import { and, desc, eq, gt, like } from 'drizzle-orm'

import { db } from '@/db'
import { account, session, user, verification } from '@/db/schema'
import type { Executor } from '@/db/types'
import { errorMessage } from '@/lib/error-message'
import { RESET_PASSWORD_TOKEN_TTL_S } from '@/lib/limits'
import type { PasswordFormMode } from '@/lib/password-form'

// A password is set by whoever holds the mailbox, never by whoever typed it
// into the sign-up form: anybody can sign up with somebody else's address,
// and a second sign-up for that address changes nothing (Better Auth answers
// it like a new one and keeps the first password). So the sign-up form asks
// for no password and sends a random one (SignupForm.vue), confirming the
// address drops whatever password the account has (dropPasswordAndSessions),
// and the confirmation link leads on to setting one with a reset token of its
// own (passwordSetupToken, from startPasswordSetup in src/lib/auth.ts). A
// reset link proves the mailbox just as well, so a password set through one
// confirms the address too (confirmEmailOnReset).
//
// Everything here that changes a password, the address's state or reset
// tokens first locks the user row (lockUser) — the lock Better Auth's reset
// and the passkey ceremonies take too (src/lib/passkeys/transactions.ts) —
// and reads the account's state again under it, so a confirmation, a reset
// and a new setup link can't interleave.

// Better Auth's reset tokens are verification rows named like this, with the
// account's id as their value
const RESET_PREFIX = 'reset-password:'

export function resetIdentifier(token: string) {
  return `${RESET_PREFIX}${token}`
}

// The user row, locked until the transaction ends, with what the callers
// decide by; undefined when there is no such account. By address the way
// Better Auth looks one up (findUserByEmail): it stores addresses in lower
// case.
export async function lockUser(
  on: Executor,
  which: { id: string } | { email: string },
) {
  const [row] = await on
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(
      'id' in which
        ? eq(user.id, which.id)
        : eq(user.email, which.email.toLowerCase()),
    )
    .for('update')
  return row
}

// The account's credential row (email and password); `userId` may be a
// column, to join on
function credentialOf(userId: string | typeof user.id) {
  return and(eq(account.userId, userId), eq(account.providerId, 'credential'))
}

// Called by Better Auth right before an unconfirmed account is marked as
// confirmed — never at the end of an address change. Afterwards the account
// has no password and no session (it can't have one yet; this makes sure),
// so nothing anyone set before the mailbox was proven stays usable. The
// confirmation is written here, with the cleared password, so the two can't
// be parted; Better Auth then writes the same value once more.
//
// Better Auth read the account before calling this, and a reset may have
// confirmed it since: under the lock, an account that is confirmed already
// (or gone) is left as it is.
//
// The race with the sign-up itself: Better Auth's sign-up writes the user
// and its credential row in separate statements, so a link opened in between
// finds no credential to clear, and the sign-up's password would land after
// the confirmation. Such an account answers `no-credential` and stays
// unconfirmed — the caller turns the link away, and "Passwort vergessen"
// still sets a password and confirms the address.
export async function dropPasswordAndSessions(
  userId: string,
): Promise<'confirmable' | 'no-credential'> {
  return db.transaction(async (on) => {
    const locked = await lockUser(on, { id: userId })
    if (!locked || locked.emailVerified) return 'confirmable'
    const cleared = await on
      .update(account)
      .set({ password: null })
      .where(credentialOf(userId))
      .returning({ id: account.id })
    if (cleared.length === 0) return 'no-credential'
    await on.delete(session).where(eq(session.userId, userId))
    await on
      .update(user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(user.id, userId))
    return 'confirmable'
  })
}

// Every reset link the account still has
export async function forgetResetTokens(userId: string, on: Executor) {
  await on
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${RESET_PREFIX}%`),
        eq(verification.value, userId),
      ),
    )
}

// For a verified sign-up confirmation (its address and, in links Better Auth
// made, the account's id): a reset token as Better Auth's "Passwort
// vergessen" makes one, replacing the account's earlier ones, so only the
// newest form to set the password works. Undefined (and nothing written)
// unless the address names that account, it is confirmed and it still has no
// password — all read under the lock.
export async function passwordSetupToken({
  email,
  userId,
}: {
  email: string
  userId?: string
}): Promise<string | undefined> {
  return db.transaction(async (on) => {
    const locked = await lockUser(on, { email })
    if (!locked?.emailVerified) return undefined
    if (userId !== undefined && userId !== locked.id) return undefined
    const [credential] = await on
      .select({ password: account.password })
      .from(account)
      .where(credentialOf(locked.id))
    if (credential?.password) return undefined
    const token = generateId(24)
    await forgetResetTokens(locked.id, on)
    await on.insert(verification).values({
      id: generateId(),
      identifier: resetIdentifier(token),
      value: locked.id,
      expiresAt: new Date(Date.now() + RESET_PASSWORD_TOKEN_TTL_S * 1000),
    })
    return token
  })
}

// What the form behind a reset link is for: `setup` when the token's account
// has no password, otherwise `reset` — also for a token that is unknown or
// expired (saving then fails like it would anyway) and when the database
// can't say. The log gets the reason only, never the query's parameters,
// which hold the token.
export async function passwordFormMode(
  token: string,
): Promise<PasswordFormMode> {
  try {
    const [row] = await db
      .select({ password: account.password })
      .from(verification)
      .innerJoin(user, eq(user.id, verification.value))
      .leftJoin(account, credentialOf(user.id))
      .where(
        and(
          eq(verification.identifier, resetIdentifier(token)),
          gt(verification.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(verification.createdAt))
      .limit(1)
    return row && !row.password ? 'setup' : 'reset'
  } catch (error) {
    console.error(
      `[auth] Art des Passwortformulars nicht ermittelt: ${errorMessage(error)}`,
    )
    return 'reset'
  }
}

// Called on every reset, in the reset's own transaction under its lock
// (`on`): without it, a password set through "Passwort vergessen" before the
// address was confirmed would be dropped again by the confirmation.
export async function confirmEmailOnReset(userId: string, on: Executor) {
  await on
    .update(user)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId))
}
