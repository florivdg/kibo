import { randomBytes } from 'node:crypto'

import {
  NOTE_FORM_TOKEN_MAX_AGE_MS,
  NOTE_FORM_TOKEN_MIN_AGE_MS,
} from '@/lib/limits'

// The token a note is pinned with: the board it was issued for, when, and a
// random nonce, signed with the current spam key (src/lib/spam/store.ts).
// notes.formToken hands one out when the composer opens, notes.create takes
// it back. A script that calls notes.create without ever loading a board has
// none, and one that fetches a token has to wait for it to ripen — then the
// budgets take over. Nothing is stored per token: the signature is the whole
// proof, and a key that is rotated out keeps verifying for as long as it
// keeps counting (a day), far longer than a token lives.
//
// The token is `<key id>.<issued at, ms>.<nonce>.<signature>`, the key id
// base64url-encoded since an operator may name a key anything. It names the
// key it was signed with, so checking it reads no key the process doesn't
// have already: only an id it doesn't know yet — a key another process just
// created — makes it look again (src/lib/spam/store.ts). The board id is only
// signed, not carried: the request names its board anyway, and a token of
// another board simply doesn't verify.

interface Signer {
  sign(value: string, now: Date): Promise<{ keyId: string; signature: string }>
  verify(
    keyId: string,
    value: string,
    signature: string,
    now: Date,
  ): Promise<boolean>
}

const TOKEN = /^([\w-]{1,256})\.(\d{1,15})\.([\w-]{16})\.([\w-]{43})$/

// What the signature covers; the prefix keeps it apart from every other value
// signed with the same key (the budget counters)
function signedValue(boardId: string, issuedAt: string, nonce: string) {
  return `note-form|${boardId}|${issuedAt}|${nonce}`
}

export async function issueFormToken(
  signer: Signer,
  boardId: string,
  now: Date,
) {
  const issuedAt = String(now.getTime())
  const nonce = randomBytes(12).toString('base64url')
  const { keyId, signature } = await signer.sign(
    signedValue(boardId, issuedAt, nonce),
    now,
  )
  const key = Buffer.from(keyId).toString('base64url')
  return `${key}.${issuedAt}.${nonce}.${signature}`
}

// Ripe, not stale, and signed for this board. Anything malformed is just as
// invalid and reaches no key.
export async function isValidFormToken(
  signer: Signer,
  token: string,
  boardId: string,
  now: Date,
) {
  const [, key, issuedAt, nonce, signature] = TOKEN.exec(token) ?? []
  if (!key || !issuedAt || !nonce || !signature) return false
  const age = now.getTime() - Number(issuedAt)
  if (age < NOTE_FORM_TOKEN_MIN_AGE_MS || age > NOTE_FORM_TOKEN_MAX_AGE_MS) {
    return false
  }
  return signer.verify(
    Buffer.from(key, 'base64url').toString(),
    signedValue(boardId, issuedAt, nonce),
    signature,
    now,
  )
}
