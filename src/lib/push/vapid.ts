import { toBase64url } from './base64url'

// Voluntary Application Server Identification, RFC 8292: every request carries
// a short-lived JWT, signed with the VAPID private key, for the push service
// the endpoint belongs to. Browsers bind a subscription to the public key, so
// a push service only delivers what that key signed.

// RFC 8292 allows at most 24 hours; half of that leaves room for clock skew
const TOKEN_LIFETIME_S = 12 * 60 * 60

const encoder = new TextEncoder()

function encodePart(value: object) {
  return toBase64url(encoder.encode(JSON.stringify(value)))
}

export function importVapidKey(privateKey: JsonWebKey) {
  return crypto.subtle.importKey(
    'jwk',
    privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

export interface VapidSigner {
  // Base64url public key, sent along as `k`
  publicKey: string
  privateKey: CryptoKey
  subject: string
}

// The Authorization header for one push service. The audience is the
// endpoint's origin, so one token serves every subscription on that service.
export async function vapidAuthorization(
  endpoint: string,
  { publicKey, privateKey, subject }: VapidSigner,
  now: Date,
) {
  const header = encodePart({ typ: 'JWT', alg: 'ES256' })
  const claims = encodePart({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + TOKEN_LIFETIME_S,
    sub: subject,
  })
  const unsigned = `${header}.${claims}`
  // Web Crypto's ECDSA signature is already r || s, the form JWS wants
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(unsigned),
  )
  return `vapid t=${unsigned}.${toBase64url(signature)}, k=${publicKey}`
}
