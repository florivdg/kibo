// Web push speaks base64url throughout: keys, the auth secret, the JWT.
// Copied into a fresh Uint8Array so Web Crypto gets a plain ArrayBuffer view.
export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

export function toBase64url(bytes: Uint8Array | ArrayBuffer) {
  return Buffer.from(
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
  ).toString('base64url')
}
