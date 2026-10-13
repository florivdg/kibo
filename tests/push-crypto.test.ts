import { describe, expect, test } from 'bun:test'

import { kitaManifest } from '@/lib/board/manifest'
import { fromBase64url, toBase64url } from '@/lib/push/base64url'
import { readVapidConfig } from '@/lib/push/config'
import { hasValidKeys, isAllowedPushEndpoint } from '@/lib/push/endpoint'
import { encryptPayload, MAX_PLAINTEXT } from '@/lib/push/encryption'
import {
  notificationPayload,
  pushTopic,
  pushTopicKey,
} from '@/lib/push/message'
import { importVapidKey, vapidAuthorization } from '@/lib/push/vapid'

import { decryptPush, newBrowser } from './helpers/push'
import { RFC8291_SERVER_KEYS } from './helpers/rfc8291-keys'

// RFC 8291, section 5 and appendix A. The base64url values are copied from
// the RFC text with the line breaks removed.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: RFC8291_SERVER_KEYS.publicKey,
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

async function rfcSenderKeys(): Promise<CryptoKeyPair> {
  const algorithm = { name: 'ECDH', namedCurve: 'P-256' }
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk',
      RFC8291_SERVER_KEYS.privateJwk,
      algorithm,
      false,
      ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey(
      'raw',
      fromBase64url(RFC.asPublic),
      algorithm,
      true,
      [],
    ),
  }
}

describe('encryptPayload', () => {
  test('reproduces the example of RFC 8291 byte for byte', async () => {
    const body = await encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      { salt: fromBase64url(RFC.salt), senderKeys: await rfcSenderKeys() },
    )
    expect(toBase64url(body)).toBe(RFC.body)
  })

  test('uses a fresh key and salt for every message', async () => {
    const browser = await newBrowser()
    const message = new TextEncoder().encode('Hallo')
    const first = await encryptPayload(message, browser)
    const second = await encryptPayload(message, browser)
    expect(toBase64url(first)).not.toBe(toBase64url(second))
    expect(await decryptPush(first, browser)).toBe('Hallo')
    expect(await decryptPush(second, browser)).toBe('Hallo')
  })

  test('refuses what would not fit into one 4096-byte message', async () => {
    const browser = await newBrowser()
    const fits = await encryptPayload(new Uint8Array(MAX_PLAINTEXT), browser)
    expect(fits.length).toBe(4096)
    expect(
      encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), browser),
    ).rejects.toThrow()
  })
})

describe('vapidAuthorization', () => {
  const now = new Date('2026-05-04T10:00:00.000Z')

  test('signs a token the public key verifies, for the push service only', async () => {
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc:def',
      {
        publicKey: RFC.asPublic,
        privateKey: await importVapidKey(RFC8291_SERVER_KEYS.privateJwk),
        subject: 'mailto:kibo@example.org',
      },
      now,
    )
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
      header,
    )
    expect(match).not.toBeNull()
    const [, head, claims, signature, key] = match!
    expect(key).toBe(RFC.asPublic)
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    })
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sub: 'mailto:kibo@example.org',
    })

    const verifier = await crypto.subtle.importKey(
      'raw',
      fromBase64url(key!),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const verify = (data: string) =>
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verifier,
        fromBase64url(signature!),
        new TextEncoder().encode(data),
      )
    expect(await verify(`${head}.${claims}`)).toBe(true)
    expect(await verify(`${head}.${claims}x`)).toBe(false)
  })
})

describe('readVapidConfig', () => {
  const values = {
    publicKey: ` ${RFC.asPublic} `,
    privateKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'x',
      y: 'y',
      d: 'd',
      key_ops: ['sign'],
      ext: true,
    }),
    subject: 'mailto:kibo@example.org',
  }

  test('takes the key material and nothing else', () => {
    expect(readVapidConfig(values)).toEqual({
      publicKey: RFC.asPublic,
      privateKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
      subject: 'mailto:kibo@example.org',
    })
  })

  test('is off unless all three are set', () => {
    expect(readVapidConfig({ ...values, subject: ' ' })).toBeNull()
    expect(readVapidConfig({ ...values, privateKey: undefined })).toBeNull()
  })

  test('calls a private key that is no JSON object malformed instead of throwing', () => {
    for (const privateKey of ['{"kty":"EC",', 'd-only', 'null', '42']) {
      expect(readVapidConfig({ ...values, privateKey })).toBe('malformed')
    }
  })
})

describe('isAllowedPushEndpoint', () => {
  test('accepts the push services browsers use', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc:APA91b',
      'https://web.push.apple.com/QGuQyavXutnMH',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
      // Samsung Internet, when it uses Samsung's own service
      'https://eu.push.samsungosp.com/v1/webpush/abc',
      'https://eu.push.samsungosp.com:443/v1/webpush/abc',
      'https://FCM.googleapis.com/fcm/send/abc',
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true)
    }
  })

  test('turns away everything else', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.tld/fcm/send/abc',
      'https://evilfcm.googleapis.com/fcm/send/abc',
      'https://sub.fcm.googleapis.com/fcm/send/abc',
      'https://push.apple.com/abc',
      'https://evilpush.apple.com/abc',
      'https://web.push.apple.com.evil.tld/abc',
      'https://notify.windows.com/abc',
      'https://push.samsungosp.com/abc',
      'https://evilpush.samsungosp.com/abc',
      'https://eu.push.samsungosp.com.evil.tld/abc',
      'https://evil.tld/fcm.googleapis.com',
      'https://127.0.0.1/abc',
      'https://[::1]/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com./fcm/send/abc',
      'fcm.googleapis.com/fcm/send/abc',
      'javascript:alert(1)',
      '',
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false)
    }
  })
})

describe('hasValidKeys', () => {
  test('wants a point on the curve and a 16-byte secret', async () => {
    const { p256dh, auth } = await newBrowser()
    expect(await hasValidKeys({ p256dh, auth })).toBe(true)
    expect(await hasValidKeys({ p256dh, auth: `${auth}AA` })).toBe(false)
    expect(await hasValidKeys({ p256dh: p256dh.slice(1), auth })).toBe(false)
    expect(await hasValidKeys({ p256dh: `${p256dh}=`, auth })).toBe(false)
    // 65 bytes with the right prefix, but no point on P-256
    const offCurve = toBase64url(new Uint8Array([4, ...new Uint8Array(64)]))
    expect(await hasValidKeys({ p256dh: offCurve, auth })).toBe(false)
  })
})

describe('the notification', () => {
  const news = {
    boardId: '3f0c2a52-8a3e-4d7e-9f45-0b8d8f3e2c11',
    boardName: 'Igelgruppe',
    kitaToken: 'abcdefghijklmnopqrstuv',
  }

  test('names the board and the note, or how many there are', () => {
    const one = notificationPayload({
      ...news,
      titles: ['Laternenfest'],
      badge: 4,
    })
    expect(one).toEqual({
      web_push: 8030,
      notification: {
        title: 'Brett „Igelgruppe“',
        body: 'Neuer Zettel: Laternenfest',
        // The board inside the Kita's app, within the manifest's scope
        navigate: `http://localhost:4321/k/abcdefghijklmnopqrstuv/${news.boardId}/`,
        tag: `board-${news.boardId}`,
        lang: 'de',
        silent: false,
      },
      // Next to the notification, digits in a string: where and how WebKit
      // reads the number for the icon
      app_badge: '4',
    })
    const three = notificationPayload({
      ...news,
      titles: ['a', 'b', 'c'],
      badge: 0,
    })
    expect(three.notification.body).toBe('3 neue Zettel')
    expect(three.app_badge).toBe('0')
  })

  test('keeps board and subscribers out of the topic, stable per subscription', async () => {
    const key = await pushTopicKey(RFC8291_SERVER_KEYS.privateJwk)
    if (!key) throw new Error('no topic key')
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
    const topic = await pushTopic(news.boardId, endpoint, key)
    // What the header may carry: 32 base64url characters
    expect(topic).toMatch(/^[\w-]{32}$/)
    // An HMAC, not the board id in any form
    expect(topic).not.toContain(news.boardId.replaceAll('-', '').slice(0, 8))
    expect(topic).not.toContain(news.boardId.slice(0, 8))
    // Stable, so a newer message replaces an undelivered one …
    const again = await pushTopicKey(RFC8291_SERVER_KEYS.privateJwk)
    expect(await pushTopic(news.boardId, endpoint, again!)).toBe(topic)
    // … another one for every subscriber of the board, so the push services
    // can't tell which endpoints follow the same board …
    const otherEndpoint = 'https://fcm.googleapis.com/fcm/send/xyz'
    expect(await pushTopic(news.boardId, otherEndpoint, key)).not.toBe(topic)
    // … and one per board
    const other = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
    expect(await pushTopic(other, endpoint, key)).not.toBe(topic)
  })

  test('derives the topic key from the VAPID private key', async () => {
    const { d: _d, ...publicOnly } = RFC8291_SERVER_KEYS.privateJwk
    expect(await pushTopicKey(publicOnly)).toBeUndefined()
    // Another key pair, other topics: nobody can work them out without it
    const pair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign'],
    )) as CryptoKeyPair
    const otherKey = await pushTopicKey(
      await crypto.subtle.exportKey('jwk', pair.privateKey),
    )
    const key = await pushTopicKey(RFC8291_SERVER_KEYS.privateJwk)
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
    expect(await pushTopic(news.boardId, endpoint, otherKey!)).not.toBe(
      await pushTopic(news.boardId, endpoint, key!),
    )
  })
})

describe('kitaManifest', () => {
  test('makes the Kita one app, started on the Kita page', () => {
    const manifest = kitaManifest('abcdefghijklmnopqrstuv', 'Kita Igelnest')
    expect(manifest).toMatchObject({
      // With the slash: the scope is a path prefix, and every board lies
      // below the Kita page
      id: '/k/abcdefghijklmnopqrstuv/',
      start_url: '/k/abcdefghijklmnopqrstuv/',
      scope: '/k/abcdefghijklmnopqrstuv/',
      name: 'Kita Igelnest',
      short_name: 'Kita Igelnest',
      display: 'standalone',
      lang: 'de',
    })
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual([
      'any',
      'any',
      'maskable',
    ])
  })

  test('shortens a long name for the launcher at a word boundary', () => {
    const shortName = (name: string) =>
      kitaManifest('abcdefghijklmnopqrstuv', name).short_name
    expect(shortName('Elternpinnwand')).toBe('Elternpinnwand')
    expect(shortName('Elternbeirat Sonnenschein')).toBe('Elternbeirat…')
    expect(shortName('Fundkiste Kita Sonnenschein')).toBe('Fundkiste Kita…')
    // Nothing sensible to keep before the space: cut the word instead
    expect(shortName('Die Elternpinnwand')).toBe('Die Elternpinn…')
    expect(shortName('Elternpinnwandsammlung')).toBe('Elternpinnwand…')
  })
})
