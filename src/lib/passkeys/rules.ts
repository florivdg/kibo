import { APIError } from 'better-auth/api'

// Relative imports: auth-options.ts (and with it this file) is also loaded by
// the schema generator, outside of Astro's @/ alias. No database and no
// astro:env here for the same reason; the checks below get what they look up
// handed in by the plugin.
import { PASSKEY_NAME_MAX } from '../limits'
import { isPlainText } from '../plain-text'

// The passkey endpoints Kibo uses: adding one on the account page (options,
// then the verification), signing in with one (the same two steps) and
// removing one. Renaming has no UI, and the account page lists the passkeys
// on the server (src/lib/passkeys/queries.ts), so those two routes are
// switched off. tests/auth-rules.test.ts checks that every passkey route is
// in one of the two lists.
export const PASSKEY_PATHS_IN_USE = [
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/delete-passkey',
]

export const UNUSED_PASSKEY_PATHS = [
  '/passkey/update-passkey',
  '/passkey/list-user-passkeys',
]

// The name a person gives a passkey ("Laptop im Büro"), already trimmed: one
// line, something visible, short enough for a row of the list
export function isValidPasskeyName(value: unknown): value is string {
  return typeof value === 'string' && isPlainText(value, PASSKEY_NAME_MAX)
}

const USER_VERIFICATION_REQUIRED = {
  code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
  message: 'User verification required',
}

// A passkey stands in for the password and the second factor together. That
// holds only if the authenticator checked a fingerprint, a face or a PIN —
// without that it is a thing someone holds, no more. The options ask for it
// (authenticatorSelection in auth-options.ts, and the login page when it
// signs in), but the plugin verifies with requireUserVerification: false, so
// these two are what actually refuses a passkey without it.
export function afterRegistration({
  verification,
}: {
  verification: { registrationInfo?: { userVerified: boolean } }
}) {
  if (verification.registrationInfo?.userVerified) return
  throw APIError.fromStatus('BAD_REQUEST', USER_VERIFICATION_REQUIRED)
}

// What a sign-in needs to look up. Method syntax, so the plugin's endpoint
// context fits and a test can hand in a fake.
export interface PasskeyLookupContext {
  context: {
    adapter: {
      findOne<T>(query: {
        model: string
        where: { field: string; value: string }[]
      }): Promise<T | null>
    }
    internalAdapter: {
      findUserById(userId: string): Promise<{ emailVerified: boolean } | null>
    }
  }
}

const PASSKEY_NOT_FOUND = {
  code: 'PASSKEY_NOT_FOUND',
  message: 'Passkey not found',
}

// Runs after the signature checked out and before the session is created.
// Besides the verification above: the password login turns an unconfirmed
// address away, and a passkey mustn't be the way around that. A backstop
// mirroring the password login — Kibo's address change keeps the address
// verified, so it takes an account that was never confirmed.
export async function afterAuthentication({
  ctx,
  verification,
  clientData,
}: {
  ctx: PasskeyLookupContext
  verification: { authenticationInfo: { userVerified: boolean } }
  clientData: { id: string }
}) {
  if (!verification.authenticationInfo.userVerified) {
    throw APIError.fromStatus('UNAUTHORIZED', USER_VERIFICATION_REQUIRED)
  }
  const passkey = await ctx.context.adapter.findOne<{ userId: string }>({
    model: 'passkey',
    where: [{ field: 'credentialID', value: clientData.id }],
  })
  // Found a moment ago by the plugin; gone only if it was removed since
  if (!passkey) throw APIError.fromStatus('UNAUTHORIZED', PASSKEY_NOT_FOUND)
  const user = await ctx.context.internalAdapter.findUserById(passkey.userId)
  if (!user) throw APIError.fromStatus('UNAUTHORIZED', PASSKEY_NOT_FOUND)
  if (!user.emailVerified) {
    throw APIError.fromStatus('FORBIDDEN', {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email not verified',
    })
  }
}
