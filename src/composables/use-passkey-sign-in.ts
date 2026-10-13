import {
  browserSupportsWebAuthnAutofill,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { onMounted, onUnmounted, ref } from 'vue'

import type { useFormSubmit } from '@/composables/use-form-submit'
import { passkeysSupported, type CeremonyResult } from '@/lib/passkeys/ceremony'
import {
  passkeySignInClient,
  type PasskeySignInClient,
} from '@/lib/passkeys/sign-in-client'

// The plugin keeps a challenge for 300 seconds (its MAX_AGE_IN_SECONDS, not
// exported), while a suggestion waits for as long as the page is open: a
// passkey picked after that would fail with CHALLENGE_NOT_FOUND. So an idle
// page asks for fresh options a minute before.
export const SUGGESTION_REFRESH_MS = 4 * 60_000

// A suggestion that ended in the browser starts again after this at the
// earliest, so a browser that turns it down at once can't spend the 20
// options a minute (src/lib/auth-options.ts) in a loop
export const SUGGESTION_RETRY_MS = 5_000

type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>
type FormSubmit = ReturnType<typeof useFormSubmit>

// Signing in with a passkey on the login page, two ways. The browser offers
// the account's passkeys in the e-mail field (conditional mediation: the
// field's autocomplete ends in `webauthn`, and the request waits in the
// background until one is picked), and the button „Mit Passkey anmelden“ asks
// in the browser's own dialog — for a passkey on a phone, say, or a browser
// that has no suggestions in the field.
//
// Only one ceremony runs at a time: starting one aborts the one before
// (@simplewebauthn's abort service), which then ends with
// ERROR_CEREMONY_ABORTED. Every suggestion and every click takes the next
// number of `generation`, and so does leaving the page; a suggestion that
// isn't the latest any more has been replaced and keeps quiet whatever it
// ends with. Whatever stays on the
// page (a closed dialog, an error, a refused passkey) puts the suggestion
// back, so the field keeps offering passkeys.
//
// The attempts run through the form's own useFormSubmit, so the form shows
// one message and one pending state for every way of signing in, the server's
// check of a picked passkey included, and every attempt clears what the last
// one said.
//
// The pieces without Vue's lifecycle, so a test can call `start` and hand in
// its own client and timers; usePasskeySignIn below is what a component uses.
export function passkeySignIn(
  redirectTo: string,
  form: FormSubmit,
  client: PasskeySignInClient = passkeySignInClient,
  timers: Timers = globalThis,
) {
  // The button needs WebAuthn at all; decided after mounting, the server
  // doesn't know. Set before anything is awaited, so it also keeps `start`
  // from running twice.
  const supported = ref(false)
  const { pending, run } = form
  let conditional = false
  let generation = 0
  let buttonActive = false
  // Signed in (or unmounted): nothing starts again
  let left = false
  // The one restart or refresh that is due
  let timer: ReturnType<Timers['setTimeout']> | undefined

  function stopTimer() {
    timers.clearTimeout(timer)
    timer = undefined
  }

  function suggestIn(delay: number) {
    stopTimer()
    timer = timers.setTimeout(() => void suggest(), delay)
  }

  function leave(result: CeremonyResult) {
    if (!result.data) return undefined
    stop()
    return { href: redirectTo }
  }

  // The suggestion's ceremony. Throwing means this browser can't suggest here
  // after all (no autofill, no such field): it stops suggesting.
  async function suggestion(options: PublicKeyCredentialRequestOptionsJSON) {
    const result = await client
      .credential(options, { autoFill: true })
      .catch(() => null)
    if (!result) {
      conditional = false
      stopTimer()
    }
    return result
  }

  async function suggest() {
    if (!conditional || left || buttonActive) return
    // A password is being checked; the suggestion still running stays
    if (pending.value) return suggestIn(SUGGESTION_RETRY_MS)
    stopTimer()
    const id = ++generation
    const { data: options } = await client
      .options()
      .catch(() => ({ data: null }))
    // The button took over (every click takes a number too); it puts the
    // suggestion back when it's done
    if (id !== generation) return
    // Without options this is a failure nobody asked for: no message, and the
    // next try only with the refresh
    suggestIn(SUGGESTION_REFRESH_MS)
    if (!options) return
    const result = await suggestion(options)
    // Otherwise aborted by the refresh or the button, or the page is gone
    if (result && id === generation) await answerSuggestion(id, result)
  }

  // A passkey picked in the field goes to the server in the form's pending
  // state, a refusal of the browser's is shown; then the field suggests again
  async function answerSuggestion(
    id: number,
    result: AuthenticationResponseJSON | CeremonyResult,
  ) {
    const picked = 'response' in result
    if (picked) {
      stopTimer()
      await run(() => client.verify(result), { leave })
    } else if (result.error) {
      await run(async () => result)
    }
    // Signed in, unmounted or replaced by the button: each takes a number
    if (id !== generation) return
    // After the server's answer the person is at the page; the browser may
    // end a ceremony by itself, as often as it likes
    if (picked) void suggest()
    else suggestIn(SUGGESTION_RETRY_MS)
  }

  // The button's ceremony from the options to the server's answer. Its
  // options are the newest, so the challenge cookie is the button's
  // (sign-in-client.ts); the suggestion they replace stays quiet.
  async function buttonCeremony() {
    const options = await client.options()
    if (!options.data) return options
    const credential = await client.credential(options.data, {
      autoFill: false,
    })
    return 'response' in credential ? client.verify(credential) : credential
  }

  async function signInWithButton() {
    if (pending.value) return
    buttonActive = true
    generation++
    stopTimer()
    // run never rejects: a failure of the ceremony ends as the form's message
    await run(buttonCeremony, { leave })
    buttonActive = false
    // Does nothing once signed in
    void suggest()
  }

  async function start() {
    if (supported.value || !passkeysSupported()) return
    supported.value = true
    conditional = await browserSupportsWebAuthnAutofill().catch(() => false)
    void suggest()
  }

  function stop() {
    left = true
    stopTimer()
    generation++
  }

  return { supported, signInWithButton, start, stop }
}

export function usePasskeySignIn(redirectTo: string, form: FormSubmit) {
  const { start, stop, ...signIn } = passkeySignIn(redirectTo, form)
  onMounted(start)
  onUnmounted(stop)
  return signIn
}
