import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser'

import { authClient } from '@/lib/auth-client'
import {
  ceremonyFailure,
  withoutExtensions,
  type CeremonyResult,
} from '@/lib/passkeys/ceremony'

// The options for the passkey, then the browser's dialog that asks for a
// fingerprint, face or PIN with them. A closed dialog ends as neither data
// nor error.
async function createCredential(): Promise<
  RegistrationResponseJSON | CeremonyResult
> {
  const options =
    await authClient.$fetch<PublicKeyCredentialCreationOptionsJSON>(
      '/passkey/generate-register-options',
      { method: 'GET' },
    )
  if (options.error) return options
  return startRegistration({ optionsJSON: options.data }).catch(ceremonyFailure)
}

// Adds a passkey to the signed-in account. Written here rather than through
// the plugin's addPasskey, for two reasons: that one builds the body of the
// last step itself, so the password the server asks for there
// (checkPasskeyRegistration in src/lib/auth.ts) can't go along, and it sends
// the name as a query parameter of the first step, where the plugin takes it
// for the WebAuthn user name — the passkey would be listed as „Laptop“ rather
// than by the account's address in the keychain.
//
// The password is checked first, on its own: a typo is said before the
// browser asks for a fingerprint, not after. That check is for the person
// only; the one that binds comes with the last step.
export async function registerPasskey({
  name,
  password,
}: {
  name: string
  password: string
}): Promise<CeremonyResult> {
  const checked = await authClient.$fetch('/verify-password', {
    method: 'POST',
    body: { password },
  })
  if (checked.error) return checked
  const credential = await createCredential()
  if (!('response' in credential)) return credential
  return authClient.$fetch('/passkey/verify-registration', {
    method: 'POST',
    body: {
      response: withoutExtensions(credential),
      name: name.trim() || undefined,
      password,
    },
  })
}
