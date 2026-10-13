import {
  browserSupportsWebAuthn,
  WebAuthnError,
  type WebAuthnErrorCode,
} from '@simplewebauthn/browser'

import type { SubmitResult } from '@/composables/use-form-submit'

// What the browser side of passkeys shares: the login page's sign-in
// (sign-in-client.ts, src/composables/use-passkey-sign-in.ts) and the account
// page's registration (register-client.ts, PasskeySettings.vue). Nothing of
// the server's here; it runs in the browser.

// Whether the browser has WebAuthn at all, by the check startAuthentication
// and startRegistration apply themselves. Only known after mounting; the
// server can't tell.
export function passkeysSupported() {
  return browserSupportsWebAuthn()
}

// What the browser's ceremony ends with when the person closed its dialog, or
// when another ceremony took its place: the dialog's „Abbrechen“ is a
// NotAllowedError, which @simplewebauthn passes through under its own code.
// Nothing for a form to say anything about.
const CANCELLED = new Set<WebAuthnErrorCode>([
  'ERROR_CEREMONY_ABORTED',
  'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
])

// What a ceremony hands to useFormSubmit: `data` once the server took it, an
// error to show, or neither when it was called off
export type CeremonyResult = SubmitResult & { data: unknown }

// How the browser's ceremony failed, as a result: a closed dialog is no
// failure, the form stays as it was. Anything that isn't a WebAuthnError (no
// WebAuthn at all, no field for the suggestions) is thrown on; the caller
// decides what that means.
export function ceremonyFailure(error: unknown): CeremonyResult {
  if (!(error instanceof WebAuthnError)) throw error
  return {
    data: null,
    error: CANCELLED.has(error.code) ? null : { code: error.code },
  }
}

// What the browser's ceremony produced, as the server gets it: what the
// browser's extensions said stays here, as with the plugin's own client
export function withoutExtensions<
  T extends { clientExtensionResults: unknown },
>(credential: T): Omit<T, 'clientExtensionResults'> {
  const { clientExtensionResults: _extensions, ...response } = credential
  return response
}
