import { fromBase64url } from './base64url'
import { importP256PublicKey } from './encryption'

// The server POSTs to whatever endpoint a visitor subscribes with, so only the
// push services browsers actually use are accepted — anything else would let
// anyone with a Kita link point Kibo at an address of their choosing (SSRF).
// Exact hosts, and subdomains only where the service hands out several.
const EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
])
const PARENT_DOMAINS = [
  '.push.apple.com',
  '.notify.windows.com',
  // Samsung Internet may use Samsung's own push service
  '.push.samsungosp.com',
]

// What may stand in front of a parent domain: DNS labels, nothing else
const SUBDOMAIN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

function isAllowedHost(hostname: string) {
  if (EXACT_HOSTS.has(hostname)) return true
  return PARENT_DOMAINS.some(
    (parent) =>
      hostname.endsWith(parent) &&
      SUBDOMAIN.test(hostname.slice(0, -parent.length)),
  )
}

// HTTPS on the default port, no credentials, one of the hosts above. Checked
// when a browser subscribes and once more right before every send.
export function isAllowedPushEndpoint(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    isAllowedHost(url.hostname)
  )
}

// The push service's host, the one part of an endpoint the log may name: the
// path identifies the subscriber
export function pushServiceHost(endpoint: string) {
  try {
    return new URL(endpoint).hostname
  } catch {
    return 'unbekannt'
  }
}

const BASE64URL = /^[\w-]+$/

function decoded(value: string) {
  return BASE64URL.test(value) ? fromBase64url(value) : new Uint8Array()
}

// The browser's keys as PushSubscription.toJSON() hands them over: an
// uncompressed P-256 point (65 bytes) that Web Crypto accepts — one off the
// curve could never be encrypted for — and a 16-byte auth secret
export async function hasValidKeys(keys: { p256dh: string; auth: string }) {
  const point = decoded(keys.p256dh)
  if (point.length !== 65 || point[0] !== 4) return false
  if (decoded(keys.auth).length !== 16) return false
  try {
    await importP256PublicKey(point)
    return true
  } catch {
    return false
  }
}
