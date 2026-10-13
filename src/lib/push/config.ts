import {
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
} from 'astro:env/server'

// The application server's identity towards the push services (RFC 8292).
// scripts/server.mjs refuses to start with only some of the three set or with
// keys that don't fit together, so here it is simply "all there" or "off" —
// a private key that isn't even JSON (only `astro dev` gets that far) is off.
export interface VapidConfig {
  // Uncompressed P-256 point, base64url; the browser subscribes with it
  publicKey: string
  // The same key pair as JWK, for signing
  privateKey: JsonWebKey
  // mailto: or https: — how a push service reaches the operator
  subject: string
}

// The private key as JWK, or null if it isn't one
function parseJwk(value: string): JsonWebKey | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as JsonWebKey)
      : null
  } catch {
    return null
  }
}

// The three variables as one configuration: null when they aren't all set,
// 'malformed' when the private key isn't JSON. scripts/server.mjs turns a
// broken key away, but `astro dev` starts without it, and a throw here would
// take every request down with it.
export function readVapidConfig(values: {
  publicKey?: string
  privateKey?: string
  subject?: string
}): VapidConfig | null | 'malformed' {
  const publicKey = values.publicKey?.trim()
  const privateKey = values.privateKey?.trim()
  const subject = values.subject?.trim()
  if (!publicKey || !privateKey || !subject) return null
  const jwk = parseJwk(privateKey)
  if (!jwk) return 'malformed'
  const { kty, crv, x, y, d } = jwk
  // Only the key material: `key_ops` or `ext` from the generator must not
  // decide what the imported key may do
  return { publicKey, privateKey: { kty, crv, x, y, d }, subject }
}

const read = readVapidConfig({
  publicKey: VAPID_PUBLIC_KEY,
  privateKey: VAPID_PRIVATE_KEY,
  subject: VAPID_SUBJECT,
})
const malformed = read === 'malformed'
const config = malformed ? null : read
if (malformed) {
  // Never the value itself: it is the key
  console.error(
    '[push] VAPID_PRIVATE_KEY ist kein JWK-JSON, Benachrichtigungen bleiben aus',
  )
}

export function vapidConfig() {
  return config
}

// Whether the feature is on at all. Off, there is no bell on the boards, the
// public actions answer 404 and the admin pages show nothing about it.
export function pushConfigured() {
  return config !== null
}

// Once at start-up, next to the SMTP line: whether the boards offer the bell
export function logPushConfiguration() {
  if (malformed) return
  console.info(
    config
      ? '[push] Benachrichtigungen eingerichtet'
      : '[push] Benachrichtigungen aus (VAPID_* nicht gesetzt)',
  )
}
