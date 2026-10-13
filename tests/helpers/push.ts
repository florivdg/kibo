import { fromBase64url, toBase64url } from '@/lib/push/base64url'
import {
  contentKeys,
  importP256PublicKey,
  newEcdhKeyPair,
} from '@/lib/push/encryption'

// The browser's side of web push: a subscription's keys, and decrypting what
// the server sent to it (RFC 8291, the receiving half)

export interface Browser {
  p256dh: string
  auth: string
  privateKey: CryptoKey
}

export async function newBrowser(): Promise<Browser> {
  const pair = await newEcdhKeyPair()
  return {
    p256dh: toBase64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    auth: toBase64url(crypto.getRandomValues(new Uint8Array(16))),
    privateKey: pair.privateKey,
  }
}

// Header: salt (16), record size (4), key id length (1), sender key (65)
export async function decryptPush(body: Uint8Array, browser: Browser) {
  const salt = body.slice(0, 16)
  const asPublic = body.slice(21, 21 + body[20]!)
  const sender = await importP256PublicKey(asPublic)
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: sender },
      browser.privateKey,
      256,
    ),
  )
  const { cek, nonce } = await contentKeys({
    ecdhSecret,
    authSecret: fromBase64url(browser.auth),
    uaPublic: fromBase64url(browser.p256dh),
    asPublic,
    salt,
  })
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, [
    'decrypt',
  ])
  const record = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      body.slice(21 + asPublic.length),
    ),
  )
  // A single record ends with the delimiter 0x02
  if (record.at(-1) !== 2) throw new Error('kein letzter Datensatz')
  return new TextDecoder().decode(record.slice(0, -1))
}
