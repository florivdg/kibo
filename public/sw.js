// fallow-ignore-file unused-file
// Kibo's service worker, registered by the Kita and board pages with scope
// /k/: one registration, and one push subscription, for every board of every
// Kita in this browser or installed app. It only shows push notifications for
// new notes and opens the board on a tap. No fetch handler and no cache: the
// pages always come from the server.
//
// The server sends Declarative Web Push JSON (RFC 8030 + WebKit's format):
// { web_push: 8030, notification: { title, body, navigate, tag, lang, silent },
//   app_badge: "3" }
// Safari can show that without this file, the number on the app's icon
// included; everywhere else it lands here.

const ICON = '/icons/icon-192.png'

// Only addresses on this origin are opened, whatever a payload says
function sameOriginUrl(value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? url.href : undefined
  } catch {
    return undefined
  }
}

function text(value, fallback) {
  return typeof value === 'string' && value ? value : fallback
}

function readMessage(data) {
  try {
    const message = data.json()
    return typeof message === 'object' && message !== null ? message : {}
  } catch {
    return {}
  }
}

// A push without a notification makes browsers revoke the permission (Safari
// right away), so a payload that can't be read still shows something
function notificationFrom(message) {
  const notification =
    typeof message.notification === 'object' && message.notification !== null
      ? message.notification
      : {}
  return {
    title: text(notification.title, 'Neuer Zettel'),
    options: {
      body: text(notification.body),
      tag: text(notification.tag),
      lang: text(notification.lang, 'de'),
      silent: notification.silent === true,
      icon: ICON,
      data: { navigate: sameOriginUrl(notification.navigate) },
    },
  }
}

// The unseen notes for the app's icon: digits, as Safari reads them
function badgeFrom(message) {
  const value = message.app_badge
  return typeof value === 'string' && /^\d{1,6}$/.test(value)
    ? Number(value)
    : undefined
}

// Where the browser has app badges (Android, desktop) and the payload says
// how many
async function showBadge(count) {
  const { navigator } = self
  if (count === undefined || !navigator.setAppBadge) return
  await (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge())
}

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const message = readMessage(event.data)
  const { title, options } = notificationFrom(message)
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // The badge is a nicety: no launcher support, no permission … never
      // fail the notification
      showBadge(badgeFrom(message)).catch(() => {}),
    ]),
  )
})

async function openBoard(navigate) {
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const open = windows.find((client) => client.url.startsWith(navigate))
  if (open) {
    // The board has been open for a while: it fetches the new notes
    open.postMessage({ type: 'kibo:new-notes' })
    await open.focus()
    return
  }
  await self.clients.openWindow(navigate)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Already checked when the notification was shown
  const navigate = event.notification.data?.navigate
  if (typeof navigate === 'string') event.waitUntil(openBoard(navigate))
})

// A renewed subscription can't be sent to the server from here: the worker
// doesn't know which boards it belongs to. The next page of the Kita that is
// opened syncs it (push.sync, see src/composables/use-push-bells.ts), and the
// server drops the old endpoint once its push service answers 404/410.
