import { getAuthenticatorName } from '@better-auth/passkey'
import { asc, count, eq } from 'drizzle-orm'

import { db } from '@/db'
import { passkey } from '@/db/schema'
import type { Executor } from '@/db/types'
import { longDate } from '@/lib/board/time'

// A row of the account page's list (PasskeySettings.vue): `label` is the name
// given or the authenticator's, `added` the day it was added, already
// formatted
export interface PasskeyListItem {
  id: string
  label: string
  added: string | null
}

// The account page's list, read on the server: Better Auth's list route is
// off (src/lib/passkeys/rules.ts), and the names of the authenticators stay
// out of the browser bundle. The name the person gave comes first; without
// one, the authenticator's name where its model is known — Apple's aren't,
// they report an AAGUID of zeros.
export async function listPasskeysOf(
  userId: string,
): Promise<PasskeyListItem[]> {
  const rows = await db
    .select({
      id: passkey.id,
      name: passkey.name,
      aaguid: passkey.aaguid,
      createdAt: passkey.createdAt,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(asc(passkey.createdAt), asc(passkey.id))
  return rows.map(({ id, name, aaguid, createdAt }) => ({
    id,
    label: name ?? getAuthenticatorName(aaguid) ?? 'Passkey',
    added: createdAt && longDate(createdAt),
  }))
}

// For PASSKEYS_PER_ACCOUNT (checkPasskeyRegistration in src/lib/auth.ts)
export async function countPasskeysOf(userId: string, on: Executor = db) {
  const [row] = await on
    .select({ passkeys: count() })
    .from(passkey)
    .where(eq(passkey.userId, userId))
  return row?.passkeys ?? 0
}

// A password reset takes the account back; a passkey added by whoever knew
// the old password must not outlive it (onPasswordReset in src/lib/auth.ts)
export async function deletePasskeysOf(userId: string, on: Executor = db) {
  await on.delete(passkey).where(eq(passkey.userId, userId))
}
