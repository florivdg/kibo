import { jwtVerify } from 'jose'

// Better Auth's verification links carry a signed JWT. Its payload says which
// flow a link belongs to: a plain sign-up confirmation has only `email`, the
// last step of an address change also `updateTo` and this request type.
const EMAIL_CHANGE_VERIFICATION = 'change-email-verification'

// Reads the payload without checking the signature. That is enough to pick a
// mail template or to turn a link away; whether a link is accepted is still
// decided by Better Auth, which does verify it. Anything that grants more
// goes through verifiedSignUpConfirmation below.
function tokenPayload(token: unknown): Record<string, unknown> {
  const payload = typeof token === 'string' ? token.split('.')[1] : undefined
  if (!payload) return {}
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    )
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// True for the link that switches an account to its new address
export function isEmailChangeVerification(token: unknown): boolean {
  return tokenPayload(token).requestType === EMAIL_CHANGE_VERIFICATION
}

// A sign-up confirmation, checked the way Better Auth's /verify-email checks
// it (signature, HS256 only, expiry): its address and, in links Better Auth
// made, the account's id. Undefined for anything else, both links of an
// address change (they carry `updateTo`) included.
export async function verifiedSignUpConfirmation(
  token: unknown,
  secret: string,
): Promise<{ email: string; userId?: string } | undefined> {
  if (typeof token !== 'string') return undefined
  const payload = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'],
  }).then(
    (verified) => verified.payload,
    () => undefined,
  )
  if (!payload) return undefined
  const { email, updateTo, userId } = payload
  if (updateTo !== undefined || typeof email !== 'string') return undefined
  if (userId !== undefined && typeof userId !== 'string') return undefined
  return { email, userId }
}

// Where the last link of an address change leads: the account page, marked as
// done. The first link (to the current address) keeps the callback the page
// asked for, so the page can tell "approved, now check the new inbox" from
// "changed". Rejections still arrive with ?error= appended to either.
export const EMAIL_CHANGE_DONE_CALLBACK = '/admin/account?emailChange=done'

// Better Auth builds the last link with the first one's callback; this swaps
// it. The token and everything else in the link stay as they are.
export function withCallbackURL(url: string, callbackURL: string) {
  const link = new URL(url)
  link.searchParams.set('callbackURL', callbackURL)
  return link.href
}
