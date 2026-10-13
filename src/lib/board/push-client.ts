// Browser-side helpers for the notification bells that don't touch the
// browser themselves, so tests can call them directly

// The VAPID public key as the page receives it (base64url, no padding)
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

// Whether a subscription was made with this key. After the operator rotates
// the keys, an old subscription can't be used anymore. Browsers that don't
// report the key get the benefit of the doubt.
export function sameServerKey(
  subscriptionKey: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!subscriptionKey) return true
  const expected = base64UrlToBytes(publicKey)
  const actual = new Uint8Array(subscriptionKey)
  return (
    actual.length === expected.length &&
    actual.every((byte, i) => byte === expected[i])
  )
}

interface DeviceInfo {
  userAgent: string
  maxTouchPoints: number
}

// iPhone, iPod and iPad. iPadOS reports itself as a Mac by default; only the
// touch screen gives it away.
export function isAppleMobile({ userAgent, maxTouchPoints }: DeviceInfo) {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  )
}

// What the bells of a page show, all alike: nothing (no push here), the
// home-screen guide for iPhone and iPad in a Safari tab, the bells, or a hint
// that the permission was denied. Which board's bell is on comes from the
// server (push.sync).
export type PushState = 'hidden' | 'install' | 'ready' | 'blocked'

interface PushEnvironment {
  // The instance has push configured (and the board, on a board page)
  publicKey: boolean
  // iPhone or iPad in a browser tab rather than the app on the home screen
  needsHomeScreen: boolean
  // Service worker, Push API and notifications are there
  supported: boolean
  permission: NotificationPermission
}

export function stateOnLoad({
  publicKey,
  needsHomeScreen,
  supported,
  permission,
}: PushEnvironment): PushState {
  if (!publicKey) return 'hidden'
  if (needsHomeScreen) return 'install'
  if (!supported) return 'hidden'
  return permission === 'denied' ? 'blocked' : 'ready'
}

// What a sync heard back: the server's answer, or an error code (undefined
// when the request itself failed)
type SyncAnswer =
  | { boardIds: string[]; unseen: number; remaining: boolean }
  | { errorCode?: string }

// What a sync means for the page. `boardIds`: the boards whose bell is on, or
// null when the page shows no bells at all: the link leads nowhere any more,
// or the Kita is paused. The sync never subscribes anew, so a board the
// server dropped (switched off by the Kita, deleted after failures) stays off
// until its bell is tapped. When the answer can't be had (offline, a spam
// limit, a server hiccup) every bell shows off: tapping one subscribes again,
// which is harmless if it was on. `unseen`: the number for the app's icon
// (src/lib/push/unseen.ts); 0 once the link leads nowhere or the Kita is
// paused — no notification comes any more —, and null, leaving the icon as
// it is, when the answer couldn't be had. `endBrowserSubscription`: the
// server answered that the endpoint follows no board anywhere any more (a
// renewed link, notifications switched off, boards deleted, subscriptions
// purged), so the page ends the browser's push subscription, as after the
// last bell (afterUnsubscribe). Only an answer that says so ends it: an
// error, a link that leads nowhere or a paused Kita never do.
export function afterSync(answer: SyncAnswer): {
  boardIds: string[] | null
  unseen: number | null
  endBrowserSubscription: boolean
} {
  if ('boardIds' in answer) {
    const ended = afterUnsubscribe(answer)
    return {
      ...ended,
      boardIds: ended.endBrowserSubscription ? [] : answer.boardIds,
    }
  }
  const gone =
    answer.errorCode === 'NOT_FOUND' || answer.errorCode === 'PAYMENT_REQUIRED'
  return {
    ...(gone ? { boardIds: null, unseen: 0 } : { boardIds: [], unseen: null }),
    endBrowserSubscription: false,
  }
}

// What switching a bell off means for the browser. `remaining`: whether its
// endpoint still follows any board of the instance (push.unsubscribe). If
// not, that was its last bell: the page ends the browser's push
// subscription too, so nothing about this browser reaches the server any
// more — no endpoint, no keys, no sync on later visits — and the icon
// shows no number, since no notification can come.
export function afterUnsubscribe({
  unseen,
  remaining,
}: {
  unseen: number
  remaining: boolean
}) {
  return remaining
    ? { unseen, endBrowserSubscription: false }
    : { unseen: 0, endBrowserSubscription: true }
}

// Answers for the app's icon can arrive out of order: the page load's sync,
// a recount, switching a bell off. Every step that will set the number takes
// a ticket when it starts; what it hands over reaches `show` only if no later
// step has started since, so an older answer never overwrites a newer one.
export function latestOnly<T>(show: (value: T) => void) {
  let issued = 0
  return () => {
    const ticket = ++issued
    return (value: T) => {
      if (ticket === issued) show(value)
    }
  }
}

// The Badging API as far as the pages use it: missing in most browsers, and
// without an installed app it does nothing
interface Badging {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

// Puts the number on the app's icon, or clears it at 0. Nothing where the
// browser has no badges; a refusal is no error worth showing.
export async function showAppBadge(badging: Badging, count: number) {
  const { setAppBadge, clearAppBadge } = badging
  if (!setAppBadge || !clearAppBadge) return
  try {
    await (count > 0
      ? setAppBadge.call(badging, count)
      : clearAppBadge.call(badging))
  } catch {
    // No launcher support, no permission, …
  }
}

// The service worker's note after a tap on a notification for a board that
// is already open (see public/sw.js)
export function isNewNotesMessage(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'kibo:new-notes'
  )
}

// What a screen reader hears when notes came in that way
export function newNotesAnnouncement(added: number): string {
  return added === 1 ? 'Ein neuer Zettel.' : `${added} neue Zettel.`
}
