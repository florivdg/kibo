import {
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import type { SubmitError } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import {
  ceremonyFailure,
  withoutExtensions,
  type CeremonyResult,
} from '@/lib/passkeys/ceremony'

// Signing in with a passkey, step by step: the options (a challenge the server
// keeps for five minutes, behind a cookie), the browser's ceremony with them,
// the server's check of what the browser signed. Written here rather than
// through the plugin's signIn.passkey, which runs the first two in one call:
// the login page has to coordinate between them (use-passkey-sign-in.ts), its
// requests for options must not overlap (below), and it asks for more user
// verification than the plugin does.
export interface PasskeySignInClient {
  options(): Promise<{
    data: PublicKeyCredentialRequestOptionsJSON | null
    error: SubmitError | null
  }>
  credential(
    options: PublicKeyCredentialRequestOptionsJSON,
    how: { autoFill: boolean },
  ): Promise<AuthenticationResponseJSON | CeremonyResult>
  verify(credential: AuthenticationResponseJSON): Promise<CeremonyResult>
}

// The plugin keeps one challenge per browser, behind one cookie, and the
// options answered last own it. So every request for options waits until the
// one before has settled: the options a caller holds last are always the ones
// the cookie points to — a suggestion's request still on its way can't land
// after the button's and have the server check the button's passkey against
// the wrong challenge. Settled either way, failures included; the caller
// handles its own.
let previous: Promise<unknown> = Promise.resolve()

export const passkeySignInClient: PasskeySignInClient = {
  options() {
    const fetching = previous.then(() =>
      authClient.$fetch<PublicKeyCredentialRequestOptionsJSON>(
        '/passkey/generate-authenticate-options',
        { method: 'GET' },
      ),
    )
    previous = fetching.catch(() => {})
    return fetching
  },

  // The plugin writes `userVerification: 'preferred'` into the options. A
  // passkey replaces password and TOTP, so the browser is told 'required': it
  // asks for the fingerprint, face or PIN, or refuses up front, rather than
  // the server turning the passkey away afterwards. That check
  // (afterAuthentication in rules.ts) still binds; this one is for the person.
  credential: (options, { autoFill }) =>
    startAuthentication({
      optionsJSON: { ...options, userVerification: 'required' },
      useBrowserAutofill: autoFill,
    }).catch(ceremonyFailure),

  verify: (credential) =>
    authClient.$fetch('/passkey/verify-authentication', {
      method: 'POST',
      body: { response: withoutExtensions(credential) },
    }),
}
