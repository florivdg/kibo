import { describe, expect, test } from 'bun:test'

import {
  afterSync,
  afterUnsubscribe,
  base64UrlToBytes,
  isAppleMobile,
  isNewNotesMessage,
  latestOnly,
  newNotesAnnouncement,
  sameServerKey,
  showAppBadge,
  stateOnLoad,
} from '@/lib/board/push-client'

// An uncompressed P-256 point as `bunx @pushforge/builder vapid` prints it
const PUBLIC_KEY =
  'BHoOl-93QXx203TVg2ycMx3-czbPjKskU_RFJxKM5upoSyXRD5uPsPXndGSiFBgDHmrmH8i6ae3LC1OvQIlMJ_A'

describe('base64UrlToBytes', () => {
  test('decodes a VAPID public key to its 65 bytes', () => {
    const bytes = base64UrlToBytes(PUBLIC_KEY)
    expect(bytes).toHaveLength(65)
    // Uncompressed points start with 0x04
    expect(bytes[0]).toBe(4)
  })

  test('handles the URL-safe alphabet and missing padding', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff])
    expect([...base64UrlToBytes('AQ')]).toEqual([1])
  })
})

describe('sameServerKey', () => {
  const key = base64UrlToBytes(PUBLIC_KEY).buffer

  test('matches the key the subscription was made with', () => {
    expect(sameServerKey(key, PUBLIC_KEY)).toBe(true)
  })

  test('tells a rotated key apart', () => {
    const other = new Uint8Array(key.slice(0))
    other[64] ^= 1
    expect(sameServerKey(other.buffer, PUBLIC_KEY)).toBe(false)
    expect(sameServerKey(new ArrayBuffer(0), PUBLIC_KEY)).toBe(false)
  })

  test('trusts browsers that do not report the key', () => {
    expect(sameServerKey(null, PUBLIC_KEY)).toBe(true)
    expect(sameServerKey(undefined, PUBLIC_KEY)).toBe(true)
  })
})

describe('isAppleMobile', () => {
  test('iPhone', () => {
    expect(
      isAppleMobile({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })

  test('iPadOS reporting itself as a Mac', () => {
    expect(
      isAppleMobile({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })

  test('a real Mac and Android are not', () => {
    expect(
      isAppleMobile({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
    expect(
      isAppleMobile({
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
        maxTouchPoints: 5,
      }),
    ).toBe(false)
  })
})

describe('stateOnLoad', () => {
  const loaded = {
    publicKey: true,
    needsHomeScreen: false,
    supported: true,
    permission: 'default',
  } as const

  test('shows the bells where push works and is configured', () => {
    expect(stateOnLoad(loaded)).toBe('ready')
    expect(stateOnLoad({ ...loaded, permission: 'granted' })).toBe('ready')
  })

  test('a denied permission blocks every bell of the page', () => {
    expect(stateOnLoad({ ...loaded, permission: 'denied' })).toBe('blocked')
  })

  test('a Safari tab on iPhone or iPad gets the home-screen guide', () => {
    expect(stateOnLoad({ ...loaded, needsHomeScreen: true })).toBe('install')
    // … but not where the instance or the board has no push
    expect(
      stateOnLoad({ ...loaded, needsHomeScreen: true, publicKey: false }),
    ).toBe('hidden')
  })

  test('no bells without push in the browser or on the server', () => {
    expect(stateOnLoad({ ...loaded, supported: false })).toBe('hidden')
    expect(stateOnLoad({ ...loaded, publicKey: false })).toBe('hidden')
  })
})

describe('afterSync', () => {
  const kept = { endBrowserSubscription: false }

  test("the server's bells and count go on the page", () => {
    expect(
      afterSync({ boardIds: ['a', 'b'], unseen: 3, remaining: true }),
    ).toEqual({ boardIds: ['a', 'b'], unseen: 3, ...kept })
    // No bell on in this Kita, but a board elsewhere still has the endpoint
    expect(afterSync({ boardIds: [], unseen: 0, remaining: true })).toEqual({
      boardIds: [],
      unseen: 0,
      ...kept,
    })
  })

  test('an endpoint that follows no board any more ends the browser subscription', () => {
    expect(afterSync({ boardIds: [], unseen: 0, remaining: false })).toEqual({
      boardIds: [],
      unseen: 0,
      endBrowserSubscription: true,
    })
  })

  test('a link that leads nowhere or a paused Kita hides the bells and clears the icon', () => {
    for (const errorCode of ['NOT_FOUND', 'PAYMENT_REQUIRED']) {
      expect(afterSync({ errorCode })).toEqual({
        boardIds: null,
        unseen: 0,
        ...kept,
      })
    }
  })

  test('anything else shows every bell off and leaves the icon', () => {
    for (const errorCode of ['BAD_REQUEST', 'TOO_MANY_REQUESTS', undefined]) {
      expect(afterSync({ errorCode })).toEqual({
        boardIds: [],
        unseen: null,
        ...kept,
      })
    }
    // The request itself failed (offline)
    expect(afterSync({})).toEqual({ boardIds: [], unseen: null, ...kept })
  })
})

describe('afterUnsubscribe', () => {
  test('a bell still on somewhere keeps the browser subscribed', () => {
    expect(afterUnsubscribe({ unseen: 2, remaining: true })).toEqual({
      unseen: 2,
      endBrowserSubscription: false,
    })
  })

  test('the last bell ends the subscription and clears the icon', () => {
    expect(afterUnsubscribe({ unseen: 0, remaining: false })).toEqual({
      unseen: 0,
      endBrowserSubscription: true,
    })
  })
})

describe('latestOnly', () => {
  test('drops an answer once a later step has started', () => {
    const shown: number[] = []
    const step = latestOnly((count: number) => shown.push(count))
    // The page load's sync, then a recount after the visitor's own note
    const pageLoad = step()
    const recount = step()
    recount(0)
    // The page load's answer, still counting that note, arrives last
    pageLoad(1)
    expect(shown).toEqual([0])
  })

  test('hands on the newest answer, even before an older one arrives', () => {
    const shown: number[] = []
    const step = latestOnly((count: number) => shown.push(count))
    const first = step()
    first(3)
    const second = step()
    second(2)
    second(1)
    expect(shown).toEqual([3, 2, 1])
    first(5)
    expect(shown).toEqual([3, 2, 1])
  })
})

describe('showAppBadge', () => {
  // A browser with the Badging API, keeping what it was asked to do. The
  // methods need the navigator as `this`, like the real ones.
  function badging(fail = false) {
    const calls: (number | 'clear')[] = []
    const navigator = {
      setAppBadge(this: unknown, count?: number) {
        if (this !== navigator) throw new TypeError('Illegal invocation')
        calls.push(count ?? 0)
        return fail ? Promise.reject(new Error('nope')) : Promise.resolve()
      },
      clearAppBadge(this: unknown) {
        if (this !== navigator) throw new TypeError('Illegal invocation')
        calls.push('clear')
        return Promise.resolve()
      },
    }
    return { navigator, calls }
  }

  test('sets the number, and clears it at 0', async () => {
    const { navigator, calls } = badging()
    await showAppBadge(navigator, 7)
    await showAppBadge(navigator, 0)
    expect(calls).toEqual([7, 'clear'])
  })

  test('does nothing without the Badging API, and never throws', async () => {
    expect(await showAppBadge({}, 3)).toBeUndefined()
    const { navigator, calls } = badging(true)
    expect(await showAppBadge(navigator, 3)).toBeUndefined()
    expect(calls).toEqual([3])
  })
})

describe("the worker's note about new notes", () => {
  test('is told apart from anything else', () => {
    expect(isNewNotesMessage({ type: 'kibo:new-notes' })).toBe(true)
    expect(isNewNotesMessage({ type: 'other' })).toBe(false)
    expect(isNewNotesMessage('kibo:new-notes')).toBe(false)
    expect(isNewNotesMessage(null)).toBe(false)
  })

  test('is announced with the number of notes', () => {
    expect(newNotesAnnouncement(1)).toBe('Ein neuer Zettel.')
    expect(newNotesAnnouncement(3)).toBe('3 neue Zettel.')
  })
})
