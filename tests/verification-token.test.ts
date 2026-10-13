import { describe, expect, test } from 'bun:test'
import { createEmailVerificationToken } from 'better-auth/api'

import {
  EMAIL_CHANGE_DONE_CALLBACK,
  isEmailChangeVerification,
  withCallbackURL,
} from '@/lib/verification-token'

const secret = 'x'.repeat(32)

// Built with Better Auth's own function, so an upgrade that changes the token
// format shows up here rather than as the wrong mail or an open session
describe('isEmailChangeVerification', () => {
  test('recognises the last step of an address change', async () => {
    const token = await createEmailVerificationToken(
      secret,
      'alt@example.org',
      'neu@example.org',
      3600,
      { requestType: 'change-email-verification' },
    )
    expect(isEmailChangeVerification(token)).toBe(true)
  })

  test('ignores the confirmation sent to the current address', async () => {
    const token = await createEmailVerificationToken(
      secret,
      'alt@example.org',
      'neu@example.org',
      3600,
      { requestType: 'change-email-confirmation' },
    )
    expect(isEmailChangeVerification(token)).toBe(false)
  })

  test('ignores a sign-up confirmation', async () => {
    const token = await createEmailVerificationToken(secret, 'a@example.org')
    expect(isEmailChangeVerification(token)).toBe(false)
  })

  test('ignores anything that is not a token', () => {
    expect(isEmailChangeVerification('')).toBe(false)
    expect(isEmailChangeVerification('a.b.c')).toBe(false)
    expect(isEmailChangeVerification(undefined)).toBe(false)
  })
})

describe('withCallbackURL', () => {
  // The last link of an address change reports "done" instead of the first
  // link's callback; the token must come through untouched
  test('replaces the callback and keeps the token', async () => {
    const token = await createEmailVerificationToken(
      secret,
      'alt@example.org',
      'neu@example.org',
    )
    const url = `https://kibo.example/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent('/admin/account?emailChange=1')}`
    const link = new URL(withCallbackURL(url, EMAIL_CHANGE_DONE_CALLBACK))
    expect(link.searchParams.get('token')).toBe(token)
    expect(link.searchParams.get('callbackURL')).toBe(
      '/admin/account?emailChange=done',
    )
    expect(link.origin + link.pathname).toBe(
      'https://kibo.example/api/auth/verify-email',
    )
  })
})
