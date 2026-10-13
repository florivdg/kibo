import {
  NOTE_FORM_TOKEN_MAX_AGE_MS,
  NOTE_FORM_TOKEN_MIN_AGE_MS,
} from '@/lib/limits'

// The composer's side of the form token (src/lib/spam/form-token.ts),
// without touching the browser, so tests can call it directly. The server
// takes a token only between NOTE_FORM_TOKEN_MIN_AGE_MS and
// NOTE_FORM_TOKEN_MAX_AGE_MS after it issued it; both are counted here from
// when the token arrived, which is after it was issued, so the client's clock
// never has to agree with the server's.

// A token this close to its end is not sent anymore but replaced first: room
// for the way to the server, and for a laptop that slept with the dialog open
const STALE_BEFORE_MS = 10 * 60_000

interface Answer<E> {
  data?: { token: string }
  error?: E
}

interface Timing {
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Issued {
  token: string
  // When it arrived, on the client's clock
  at: number
}

// What one request for a token brought: the token, or why there is none
type Fetched<E> =
  { issued: Issued; error?: undefined } | { issued?: undefined; error: E }

// Keeps one token for a board's composer: fetched when it opens (prepare),
// handed out when a note is sent (ready). Nobody types a note in three
// seconds, but whoever does waits out the rest instead of being refused; a
// token left too long is replaced on the spot. Either way the visitor sees
// nothing of it but a slightly longer „Wird angepinnt …“.
export function formTokens<E>(
  fetchToken: () => Promise<Answer<E>>,
  { clock = Date.now, sleep = wait }: Timing = {},
) {
  let issued: Issued | undefined
  let fetching: Promise<Fetched<E>> | undefined

  // One request at a time: opening the composer and sending right away share
  // the one prepare started
  function fetchOnce() {
    fetching ??= fetchToken()
      .then(({ data, error }): Fetched<E> => {
        if (!data) return { error: error as E }
        issued = { token: data.token, at: clock() }
        return { issued }
      })
      .finally(() => {
        fetching = undefined
      })
    return fetching
  }

  // Neither close to its end nor from the future: a clock that was set back
  // makes the age negative, and the token's real age unknown
  function usable(held: Issued | undefined): held is Issued {
    if (held === undefined) return false
    const age = clock() - held.at
    return age >= 0 && age < NOTE_FORM_TOKEN_MAX_AGE_MS - STALE_BEFORE_MS
  }

  // Waits until the server takes the token, but never longer than a fresh
  // one needs, whatever the clock did
  async function ripen(held: Issued) {
    const early = Math.min(
      held.at + NOTE_FORM_TOKEN_MIN_AGE_MS - clock(),
      NOTE_FORM_TOKEN_MIN_AGE_MS,
    )
    if (early > 0) await sleep(early)
  }

  // When the composer opens. A failure is asked again when the note is sent,
  // where it can be shown.
  function prepare() {
    if (!usable(issued)) fetchOnce().catch(() => undefined)
  }

  // A token the server takes now, or the error that kept one from coming. A
  // network failure rejects, like the actions themselves do.
  async function ready(): Promise<
    { token: string; error?: undefined } | { token?: undefined; error: E }
  > {
    let held = issued
    if (!usable(held)) {
      const fetched = await fetchOnce()
      if (!fetched.issued) return { error: fetched.error }
      held = fetched.issued
    }
    await ripen(held)
    if (usable(held)) return { token: held.token }
    // The device slept while the token ripened: one new token, and that one
    // goes out once it has ripened, whatever happens meanwhile
    const fetched = await fetchOnce()
    if (!fetched.issued) return { error: fetched.error }
    await ripen(fetched.issued)
    return { token: fetched.issued.token }
  }

  // After the server refused the token: the next note fetches a new one
  function discard() {
    issued = undefined
  }

  return { prepare, ready, discard }
}
