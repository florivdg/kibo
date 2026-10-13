import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

import { isoCBOR } from '@simplewebauthn/server/helpers'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import { BETTER_AUTH_URL } from 'astro:env/server'

const origin = new URL(BETTER_AUTH_URL)
const base64 = (value: Uint8Array) => Buffer.from(value).toString('base64url')
const hash = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest()

// A software authenticator: the real plugin checks the attestation, RP,
// challenge, UV flag and signature. Nothing in its verifier is mocked.
export function softwarePasskey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
  const jwk = publicKey.export({ format: 'jwk' })
  const credentialId = randomBytes(32)
  const id = base64(credentialId)
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  )
  let counter = 0

  function clientData(type: string, challenge: string) {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin.origin,
        crossOrigin: false,
      }),
    )
  }

  function register(
    challenge: string,
    verified = true,
  ): RegistrationResponseJSON {
    const length = Buffer.alloc(2)
    length.writeUInt16BE(credentialId.length)
    const authData = Buffer.concat([
      hash(origin.hostname),
      Buffer.from([verified ? 0x45 : 0x41]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      length,
      credentialId,
      cose,
    ])
    const attestation = new Map<
      string,
      string | Uint8Array | Map<string, never>
    >([
      ['fmt', 'none'],
      ['authData', authData],
      ['attStmt', new Map<string, never>()],
    ])
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: base64(clientData('webauthn.create', challenge)),
        attestationObject: base64(isoCBOR.encode(attestation)),
        transports: ['internal'],
      },
    }
  }

  function authenticate(
    challenge: string,
    verified = true,
  ): AuthenticationResponseJSON {
    const count = Buffer.alloc(4)
    count.writeUInt32BE(++counter)
    const authData = Buffer.concat([
      hash(origin.hostname),
      Buffer.from([verified ? 0x05 : 0x01]),
      count,
    ])
    const data = clientData('webauthn.get', challenge)
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        authenticatorData: base64(authData),
        clientDataJSON: base64(data),
        signature: base64(
          sign('sha256', Buffer.concat([authData, hash(data)]), privateKey),
        ),
      },
    }
  }

  return { id, register, authenticate }
}

export function cookiesOf(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}
