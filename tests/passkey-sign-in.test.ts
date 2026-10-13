import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import * as webauthn from '@simplewebauthn/browser'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { useFormSubmit } from '@/composables/use-form-submit'
import {
  passkeySignIn,
  SUGGESTION_REFRESH_MS,
  SUGGESTION_RETRY_MS,
} from '@/composables/use-passkey-sign-in'
import * as authClientModule from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import type { CeremonyResult } from '@/lib/passkeys/ceremony'
import {
  passkeySignInClient,
  type PasskeySignInClient,
} from '@/lib/passkeys/sign-in-client'

// The login page's passkey sign-in (src/composables/use-passkey-sign-in.ts)
// with a client whose steps the test ends by hand — the options, the
// browser's ceremony (the suggestion in the e-mail field with autoFill, the
// button's dialog without) and the server's check — and timers it fires
// itself. The client's own ceremony (src/lib/passkeys/sign-in-client.ts) at
// the end, with @simplewebauthn's startAuthentication standing in.

type OptionsAnswer = Awaited<ReturnType<PasskeySignInClient['options']>>
type CeremonyAnswer = AuthenticationResponseJSON | CeremonyResult

// A promise the test settles by hand, kept in `list`
function pending<T, Extra extends object = object>(
  list: (PromiseWithResolvers<T> & Extra)[],
  extra = {} as Extra,
) {
  const step = { ...Promise.withResolvers<T>(), ...extra }
  list.push(step)
  return step.promise
}

function fakeClient() {
  const options: PromiseWithResolvers<OptionsAnswer>[] = []
  const ceremonies: (PromiseWithResolvers<CeremonyAnswer> & {
    autoFill: boolean
  })[] = []
  const verifications: PromiseWithResolvers<CeremonyResult>[] = []
  const client: PasskeySignInClient = {
    options: () => pending(options),
    credential: (_options, { autoFill }) => pending(ceremonies, { autoFill }),
    verify: () => pending(verifications),
  }
  const suggestions = () => ceremonies.filter(({ autoFill }) => autoFill)
  const dialogs = () => ceremonies.filter(({ autoFill }) => !autoFill)
  return { client, options, suggestions, dialogs, verifications }
}

type Timers = Parameters<typeof passkeySignIn>[3]

function fakeTimers() {
  const scheduled: { callback: () => void; delay: number; due: boolean }[] = []
  const timers = {
    setTimeout: (callback: () => void, delay: number) =>
      scheduled.push({ callback, delay, due: true }) - 1,
    clearTimeout: (handle?: number) => {
      if (handle !== undefined) scheduled[handle]!.due = false
    },
  } as unknown as Timers
  const due = () => scheduled.filter((timer) => timer.due)
  const delays = () => due().map(({ delay }) => delay)
  // The one timer that is due, run as if its time had come
  const fire = () => {
    const [timer] = due()
    timer!.due = false
    timer!.callback()
  }
  return { timers, due, delays, fire }
}

const OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'preferred',
} satisfies PublicKeyCredentialRequestOptionsJSON
const offered: OptionsAnswer = { data: OPTIONS, error: null }
const CREDENTIAL: AuthenticationResponseJSON = {
  id: 'cred',
  rawId: 'cred',
  type: 'public-key',
  response: { authenticatorData: '', clientDataJSON: '', signature: '' },
  clientExtensionResults: {},
}
// What the client makes of a closed or aborted ceremony
const quiet: CeremonyResult = { data: null, error: null }
const signedIn: CeremonyResult = { data: { session: {} }, error: null }
const refused = (code: string, status = 400): CeremonyResult => ({
  data: null,
  error: { code, status },
})

// Lets the promises that are already settled run their continuations
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let location: { href: string }

// A browser with WebAuthn, as @simplewebauthn checks for it: a global
// PublicKeyCredential that is a function, with isConditionalMediationAvailable
// where the browser can suggest passkeys in a field
function browser(conditionalMediation: boolean | undefined) {
  location = { href: '/admin/login' }
  globalThis.PublicKeyCredential = Object.assign(
    function PublicKeyCredential() {},
    conditionalMediation === undefined
      ? {}
      : { isConditionalMediationAvailable: async () => conditionalMediation },
  ) as unknown as typeof PublicKeyCredential
  globalThis.window = {
    addEventListener: () => {},
    location,
  } as unknown as Window & typeof globalThis
}

afterEach(() => {
  // @ts-expect-error: the test runner has neither of its own
  delete globalThis.window
  // @ts-expect-error: see above
  delete globalThis.PublicKeyCredential
})

describe('finding out what the browser can', () => {
  test('without WebAuthn there is no button and no suggestion', async () => {
    globalThis.window = {} as Window & typeof globalThis
    const { client, options } = fakeClient()
    const signIn = passkeySignIn('/admin', useFormSubmit(), client)
    await signIn.start()
    expect(signIn.supported.value).toBe(false)
    expect(options).toHaveLength(0)
  })

  test('the field only suggests where the browser offers that', async () => {
    for (const conditional of [false, undefined]) {
      browser(conditional)
      const { client, options } = fakeClient()
      const signIn = passkeySignIn('/admin', useFormSubmit(), client)
      await signIn.start()
      expect(signIn.supported.value).toBe(true)
      expect(options).toHaveLength(0)
    }
  })

  test('starts the suggestion once', async () => {
    browser(true)
    const { client, options } = fakeClient()
    const signIn = passkeySignIn('/admin', useFormSubmit(), client)
    await signIn.start()
    await signIn.start()
    expect(options).toHaveLength(1)
  })
})

describe('the suggestion and the button', () => {
  let fake: ReturnType<typeof fakeClient>
  let clock: ReturnType<typeof fakeTimers>
  // The login form's own state, which the passkey attempts share
  let form: ReturnType<typeof useFormSubmit>
  let signIn: ReturnType<typeof passkeySignIn>

  // Answers the newest options request; the ceremony with them starts
  async function offer(answer = offered) {
    fake.options.at(-1)!.resolve(answer)
    await settle()
  }

  // The button's attempt up to its dialog; wrapped, so awaiting this doesn't
  // wait for the attempt
  async function openDialog() {
    const button = signIn.signInWithButton()
    await settle()
    await offer()
    return { button }
  }

  beforeEach(async () => {
    browser(true)
    fake = fakeClient()
    clock = fakeTimers()
    form = useFormSubmit()
    signIn = passkeySignIn('/admin/boards', form, fake.client, clock.timers)
    await signIn.start()
  })

  test('a passkey picked in the field signs in', async () => {
    await offer()
    fake.suggestions()[0]!.resolve(CREDENTIAL)
    await settle()
    // The server's check runs in the form's pending state
    expect(form.pending.value).toBe(true)
    expect(clock.due()).toHaveLength(0)
    fake.verifications[0]!.resolve(signedIn)
    await settle()
    expect(location.href).toBe('/admin/boards')
    expect(form.pending.value).toBe(true)
    // Nothing starts again on the way out
    expect(fake.options).toHaveLength(1)
    expect(clock.due()).toHaveLength(0)
  })

  test('the button signs in and leaves for the page asked for', async () => {
    await offer()
    const { button } = await openDialog()
    // The dialog aborted the suggestion
    fake.suggestions()[0]!.resolve(quiet)
    fake.dialogs()[0]!.resolve(CREDENTIAL)
    await settle()
    fake.verifications[0]!.resolve(signedIn)
    await button
    await settle()
    expect(location.href).toBe('/admin/boards')
    expect(form.error.value).toBeNull()
    expect(fake.options).toHaveLength(2)
    expect(clock.due()).toHaveLength(0)
  })

  // Which of the two requests the server answers last is the client's
  // concern (the end of this file)
  test('a click while the suggestion fetches its options takes over', async () => {
    const button = signIn.signInWithButton()
    await settle()
    expect(fake.options).toHaveLength(2)
    await offer()
    // The suggestion's options arrive late and start nothing that would abort
    // the button's dialog
    fake.options[0]!.resolve(offered)
    await settle()
    expect(fake.dialogs()).toHaveLength(1)
    expect(fake.suggestions()).toHaveLength(0)
    fake.dialogs()[0]!.resolve(quiet)
    await button
    await settle()
    // The suggestion is back, with options of its own
    expect(fake.options).toHaveLength(3)
    expect(form.error.value).toBeNull()
  })

  test('a closed dialog says nothing and brings the suggestion back', async () => {
    await offer()
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { button } = await openDialog()
      fake.suggestions().at(-1)!.resolve(quiet)
      fake.dialogs().at(-1)!.resolve(quiet)
      await button
      await settle()
      expect(form.error.value).toBeNull()
      expect(form.pending.value).toBe(false)
      expect(fake.options).toHaveLength(2 * attempt + 1)
      await offer()
      expect(fake.suggestions()).toHaveLength(attempt + 1)
      expect(location.href).toBe('/admin/login')
    }
  })

  test('a failed attempt says why and brings the suggestion back', async () => {
    await offer()
    const { button } = await openDialog()
    fake.dialogs()[0]!.resolve(CREDENTIAL)
    await settle()
    const failure = refused('PASSKEY_NOT_FOUND', 401)
    fake.verifications[0]!.resolve(failure)
    await button
    await settle()
    expect(form.error.value).toBe(authErrorMessage(failure.error!))
    expect(form.pending.value).toBe(false)
    expect(fake.options).toHaveLength(3)
    // The suggestion the dialog aborted ends later and says nothing
    fake.suggestions()[0]!.resolve(quiet)
    await settle()
    expect(form.error.value).toBe(authErrorMessage(failure.error!))
  })

  test('a passkey picked in the field that fails says why', async () => {
    await offer()
    fake.suggestions()[0]!.resolve(CREDENTIAL)
    await settle()
    const failure = refused('EMAIL_NOT_VERIFIED', 403)
    fake.verifications[0]!.resolve(failure)
    await settle()
    expect(form.error.value).toBe(authErrorMessage(failure.error!))
    // The code too, so the form offers a new confirmation link
    expect(form.errorCode.value).toBe('EMAIL_NOT_VERIFIED')
    expect(location.href).toBe('/admin/login')
  })

  // A challenge that expired, say: the field offers passkeys again at once
  test('a refused pick says why and suggests again', async () => {
    await offer()
    fake.suggestions()[0]!.resolve(CREDENTIAL)
    await settle()
    const failure = refused('CHALLENGE_NOT_FOUND')
    fake.verifications[0]!.resolve(failure)
    await settle()
    expect(form.error.value).toBe(authErrorMessage(failure.error!))
    expect(fake.options).toHaveLength(2)
    await offer()
    expect(fake.suggestions()).toHaveLength(2)
  })

  test('an idle page refreshes its suggestion before the challenge expires', async () => {
    await offer()
    expect(clock.delays()).toEqual([SUGGESTION_REFRESH_MS])
    clock.fire()
    await settle()
    expect(fake.options).toHaveLength(2)
    await offer()
    expect(fake.suggestions()).toHaveLength(2)
    // The old one, aborted by the new, ends without a word or a restart
    fake.suggestions()[0]!.resolve(quiet)
    await settle()
    expect(form.error.value).toBeNull()
    expect(fake.options).toHaveLength(2)
    expect(clock.delays()).toEqual([SUGGESTION_REFRESH_MS])
  })

  test('options the suggestion did not get are asked for with the refresh', async () => {
    await offer(refused('TOO_MANY_REQUESTS', 429) as OptionsAnswer)
    expect(form.error.value).toBeNull()
    expect(fake.options).toHaveLength(1)
    expect(clock.delays()).toEqual([SUGGESTION_REFRESH_MS])
    clock.fire()
    await settle()
    expect(fake.options).toHaveLength(2)
  })

  test('a browser that cannot suggest after all stops suggesting', async () => {
    await offer()
    fake
      .suggestions()[0]!
      .reject(new Error('Browser does not support WebAuthn autofill'))
    await settle()
    expect(clock.due()).toHaveLength(0)
    expect(form.error.value).toBeNull()
    // The button still works, and puts no suggestion back
    const { button } = await openDialog()
    fake.dialogs()[0]!.resolve(quiet)
    await button
    await settle()
    expect(fake.options).toHaveLength(2)
    expect(fake.suggestions()).toHaveLength(1)
  })

  test('a suggestion the browser ended starts again a little later', async () => {
    await offer()
    fake.suggestions()[0]!.resolve(quiet)
    await settle()
    expect(fake.options).toHaveLength(1)
    expect(clock.delays()).toEqual([SUGGESTION_RETRY_MS])
    clock.fire()
    await settle()
    expect(fake.options).toHaveLength(2)
  })

  // The browser may refuse at once, again and again; that is no reason to ask
  // the server faster
  test('a suggestion the browser refused says why and starts again a little later', async () => {
    await offer()
    const failure = refused('ERROR_INVALID_DOMAIN')
    fake.suggestions()[0]!.resolve(failure)
    await settle()
    expect(form.error.value).toBe(authErrorMessage(failure.error!))
    expect(fake.options).toHaveLength(1)
    expect(clock.delays()).toEqual([SUGGESTION_RETRY_MS])
  })

  // The password's message, say, goes once a passkey is tried
  test('an attempt clears what the form said before', async () => {
    await offer()
    form.refuse('INVALID_EMAIL_OR_PASSWORD', 'Falsches Passwort')
    const { button } = await openDialog()
    fake.dialogs()[0]!.resolve(quiet)
    await button
    expect(form.error.value).toBeNull()
    expect(form.errorCode.value).toBeNull()
  })
})

// The ceremony itself, with @simplewebauthn's startAuthentication standing in
// for the browser's
describe('the ceremony', () => {
  const real = { ...webauthn }
  let calls: Parameters<typeof webauthn.startAuthentication>[0][] = []
  let answer: () => Promise<AuthenticationResponseJSON> = async () => CREDENTIAL
  void mock.module('@simplewebauthn/browser', () => ({
    ...real,
    startAuthentication: (
      options: Parameters<typeof webauthn.startAuthentication>[0],
    ) => {
      calls.push(options)
      return answer()
    },
  }))
  afterAll(() => {
    void mock.module('@simplewebauthn/browser', () => real)
  })
  beforeEach(() => {
    calls = []
    answer = async () => CREDENTIAL
  })

  const failure = (code: webauthn.WebAuthnErrorCode) => async () => {
    throw new webauthn.WebAuthnError({
      message: code,
      code,
      cause: new Error(),
    })
  }

  test('asks the browser for user verification', async () => {
    for (const autoFill of [true, false]) {
      expect(await passkeySignInClient.credential(OPTIONS, { autoFill })).toBe(
        CREDENTIAL,
      )
      expect(calls.at(-1)).toEqual({
        optionsJSON: { ...OPTIONS, userVerification: 'required' },
        useBrowserAutofill: autoFill,
      })
    }
  })

  test('an aborted ceremony is quiet, any other failure says its code', async () => {
    answer = failure('ERROR_CEREMONY_ABORTED')
    expect(
      await passkeySignInClient.credential(OPTIONS, { autoFill: true }),
    ).toEqual(quiet)
    answer = failure('ERROR_INVALID_DOMAIN')
    expect(
      await passkeySignInClient.credential(OPTIONS, { autoFill: false }),
    ).toEqual({ data: null, error: { code: 'ERROR_INVALID_DOMAIN' } })
  })

  test('anything but a WebAuthnError is thrown on', async () => {
    answer = async () => {
      throw new Error('Browser does not support WebAuthn autofill')
    }
    expect(
      passkeySignInClient.credential(OPTIONS, { autoFill: true }),
    ).rejects.toThrow('autofill')
  })
})

// The requests for options, with Better Auth's $fetch standing in. The
// plugin keeps one challenge cookie per browser; the options answered last
// own it.
describe('the options', () => {
  const real = { ...authClientModule }
  const requests: PromiseWithResolvers<OptionsAnswer>[] = []
  void mock.module('@/lib/auth-client', () => ({
    authClient: { $fetch: () => pending(requests) },
  }))
  afterAll(() => {
    void mock.module('@/lib/auth-client', () => real)
  })

  test('a request waits for the one before to settle', async () => {
    const first = passkeySignInClient.options()
    const second = passkeySignInClient.options()
    const third = passkeySignInClient.options()
    await settle()
    expect(requests).toHaveLength(1)
    requests[0]!.resolve(offered)
    expect(await first).toBe(offered)
    await settle()
    expect(requests).toHaveLength(2)
    // A failed one holds up nothing; its caller gets the failure
    requests[1]!.reject(new Error('offline'))
    expect(await second.catch((error: Error) => error.message)).toBe('offline')
    await settle()
    expect(requests).toHaveLength(3)
    requests[2]!.resolve(offered)
    expect(await third).toBe(offered)
  })
})
