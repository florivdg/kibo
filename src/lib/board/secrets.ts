import { createHash, randomBytes } from 'node:crypto'

import { BETTER_AUTH_URL } from 'astro:env/server'

import { kitaBoardPath, kitaPath } from './paths'

// 128 bits: long enough that Kita links can't be guessed or enumerated
export function newLinkToken() {
  return randomBytes(16).toString('base64url')
}

// What newLinkToken makes: 22 base64url characters. Anything else can't be a
// Kita link and never reaches the database.
export function isLinkToken(value: string) {
  return /^[\w-]{22}$/.test(value)
}

// Given to the poster's browser once; only its hash is stored
export function newDeleteKey() {
  return randomBytes(24).toString('base64url')
}

export function hashDeleteKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

// BETTER_AUTH_URL is the app's public origin
export function kitaUrl(kitaToken: string) {
  return new URL(kitaPath(kitaToken), BETTER_AUTH_URL).href
}

export function kitaBoardUrl(kitaToken: string, boardId: string) {
  return new URL(kitaBoardPath(kitaToken, boardId), BETTER_AUTH_URL).href
}
