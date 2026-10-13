// Better Auth's verification links carry a signed JWT. Its payload says which
// flow a link belongs to: a plain sign-up confirmation has only `email`, the
// last step of an address change also `updateTo` and this request type.
const EMAIL_CHANGE_VERIFICATION = 'change-email-verification'

// Reads the payload without checking the signature. That is enough to pick a
// mail template or to turn a link away; whether a link is accepted is still
// decided by Better Auth, which does verify it.
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
