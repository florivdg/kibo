import { fromBase64url } from './base64url'

// Message encryption for web push, RFC 8291 with the aes128gcm content coding
// of RFC 8188 — the one every current push service accepts, Apple's included.
// Plain Web Crypto, nothing else: an ephemeral ECDH key pair per message, the
// shared secret mixed with the browser's auth secret, one AES-GCM record.

const RECORD_SIZE = 4096
const KEY_LENGTH = 65
// 4096 bytes is what push services must accept for the whole body: minus the
// header (86), the AES-GCM tag (16) and the padding delimiter (1)
export const MAX_PLAINTEXT = RECORD_SIZE - 86 - 16 - 1

const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  )
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

// HKDF-Extract followed by HKDF-Expand, which is what Web Crypto's HKDF does
// in one call
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

interface KeyMaterial {
  ecdhSecret: Uint8Array<ArrayBuffer>
  authSecret: Uint8Array<ArrayBuffer>
  // Both public keys as uncompressed points: the browser's and the sender's
  uaPublic: Uint8Array<ArrayBuffer>
  asPublic: Uint8Array<ArrayBuffer>
  salt: Uint8Array<ArrayBuffer>
}

// Content encryption key and nonce, the same on both ends. The auth secret
// keeps a push service that only knows the public keys from decrypting.
export async function contentKeys({
  ecdhSecret,
  authSecret,
  uaPublic,
  asPublic,
  salt,
}: KeyMaterial) {
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  return {
    cek: await hkdf(
      salt,
      ikm,
      encoder.encode('Content-Encoding: aes128gcm\0'),
      16,
    ),
    nonce: await hkdf(
      salt,
      ikm,
      encoder.encode('Content-Encoding: nonce\0'),
      12,
    ),
  }
}

export interface SubscriptionKeys {
  // The browser's P-256 public key and auth secret, base64url
  p256dh: string
  auth: string
}

// Fixed in the tests to reproduce RFC 8291's example; random otherwise
interface EncryptionOptions {
  salt?: Uint8Array<ArrayBuffer>
  senderKeys?: CryptoKeyPair
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

// A fresh P-256 key pair for ECDH: the sender's for each message
export function newEcdhKeyPair() {
  return crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
}

// An uncompressed P-256 point as ECDH public key. Rejects a point that isn't
// on the curve.
export function importP256PublicKey(point: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', point, ECDH, false, [])
}

// The complete request body: header (salt, record size, sender key) and the
// single encrypted record
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  keys: SubscriptionKeys,
  options: EncryptionOptions = {},
) {
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new Error('Push-Nachricht ist zu lang')
  }
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const sender = options.senderKeys ?? (await newEcdhKeyPair())
  const uaPublic = fromBase64url(keys.p256dh)

  const receiver = await importP256PublicKey(uaPublic)
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', sender.publicKey),
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: receiver },
      sender.privateKey,
      256,
    ),
  )
  const { cek, nonce } = await contentKeys({
    ecdhSecret,
    authSecret: fromBase64url(keys.auth),
    uaPublic,
    asPublic,
    salt,
  })

  // One record, so it is also the last: delimiter 0x02, no padding
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, [
    'encrypt',
  ])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    concat(plaintext, new Uint8Array([2])),
  )

  const header = new Uint8Array(16 + 4 + 1 + KEY_LENGTH)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = KEY_LENGTH
  header.set(asPublic, 21)
  return concat(header, new Uint8Array(ciphertext))
}
