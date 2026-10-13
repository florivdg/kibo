import { kitaBoardUrl } from '@/lib/board/secrets'

import { fromBase64url, toBase64url } from './base64url'
import { encryptPayload, type SubscriptionKeys } from './encryption'

// What a notification says and how the request that carries it looks.

// A message nobody read within a day is stale news
const TTL_SECONDS = 86_400
// Board names and note titles are far shorter already (BOARD_NAME_MAX,
// NOTE_TITLE_MAX); this only keeps the payload bounded whatever the schema
const MAX_TEXT = 100

function shorten(text: string) {
  const chars = Array.from(text)
  return chars.length > MAX_TEXT
    ? `${chars.slice(0, MAX_TEXT - 1).join('')}…`
    : text
}

export interface BoardNews {
  boardId: string
  boardName: string
  // The Kita link the board is opened through (src/lib/board/paths.ts)
  kitaToken: string
  // Titles of the new notes this subscriber hasn't posted themselves
  titles: string[]
  // The number for the app's icon: this subscriber's unseen notes on the
  // Kita's boards, at most BADGE_MAX (src/lib/push/unseen.ts)
  badge: number
}

// Declarative Web Push (the format Safari shows on its own, and which the
// service worker in public/sw.js shows everywhere else). Board name and note
// title or count only — never the text, the author or a contact.
// `app_badge` sits next to `notification`, as a string of digits: where
// WebKit reads it since it was moved out of `notification` during the
// standards work (WebKit bug 293457; the example in WebKit's blog post
// "Meet Declarative Web Push" still shows the old place). Safari puts it
// on the icon of the home-screen app itself, the service worker does
// elsewhere.
export function notificationPayload({
  boardId,
  boardName,
  kitaToken,
  titles,
  badge,
}: BoardNews) {
  const [first] = titles
  const body =
    titles.length === 1 && first !== undefined
      ? `Neuer Zettel: ${shorten(first)}`
      : `${titles.length} neue Zettel`
  return {
    web_push: 8030,
    notification: {
      title: `Brett „${shorten(boardName)}“`,
      body,
      // The board inside the Kita's app: within the scope of its manifest,
      // so a tap opens it there rather than in the browser
      navigate: kitaBoardUrl(kitaToken, boardId),
      // A newer notification for the same board replaces the older one
      tag: `board-${boardId}`,
      lang: 'de',
      silent: false,
    },
    app_badge: String(badge),
  }
}

// Lets the push service replace an undelivered message for the same board
// with the newer one (RFC 8030, section 5.4: only within one push
// subscription, so per board and endpoint). The push services see this
// header, so it must name neither the board nor what its subscribers share:
// it is an HMAC-SHA256 of board id and endpoint, base64url and cut to the 32
// characters the header allows — the same board and endpoint always get the
// same topic, every subscriber another one, and nobody without the key can
// tell which board it is, link it to a board id from a Kita link or see
// which endpoints follow the same board.
const TOPIC_LENGTH = 32
// What the topic key is derived for; another use of the VAPID key would
// name another label
const TOPIC_KEY_LABEL = new TextEncoder().encode('kibo push topic v1')

// The HMAC key of the topics, derived (HKDF-SHA256) from the VAPID private
// key: a secret only the server has, there whenever push is, and stable as
// long as the subscriptions are — a new VAPID key pair ends every
// subscription anyway (docs/selbst-hosten/benachrichtigungen.md). Undefined
// for a key without its private part, which then goes without the header.
export async function pushTopicKey(privateKey: JsonWebKey) {
  if (!privateKey.d) return undefined
  const secret = await crypto.subtle.importKey(
    'raw',
    fromBase64url(privateKey.d),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: TOPIC_KEY_LABEL,
    },
    secret,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
}

export async function pushTopic(
  boardId: string,
  endpoint: string,
  key: CryptoKey,
) {
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${boardId}\n${endpoint}`),
  )
  return toBase64url(mac).slice(0, TOPIC_LENGTH)
}

// The payload as sent, before encryption. Built once per distinct content:
// most subscribers of a fan-out get the same one.
export function notificationPlaintext(news: BoardNews) {
  return new TextEncoder().encode(JSON.stringify(notificationPayload(news)))
}

// Everything fetch() needs besides the endpoint and the abort signal. Only the
// encryption is per subscriber; the VAPID header serves a whole push service.
export async function pushRequest(
  keys: SubscriptionKeys,
  plaintext: Uint8Array<ArrayBuffer>,
  { topic, authorization }: { topic?: string; authorization: string },
) {
  return {
    method: 'POST',
    headers: {
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(TTL_SECONDS),
      urgency: 'normal',
      ...(topic ? { topic } : {}),
      authorization,
    },
    body: await encryptPayload(plaintext, keys),
  }
}
