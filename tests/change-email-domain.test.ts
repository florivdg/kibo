import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { signupPolicy } from '@/lib/instance'

import { answer, authRequests } from './helpers/auth'

// The hook on /change-email as the handler runs it (src/lib/auth.ts), against
// the local PostgreSQL. The rules themselves: tests/signup-rules.test.ts.
const LISTED = 'kita-verbund.example'

// Better Auth counts /change-email per network, five an hour. TEST-NET-3 is
// this file's network (tests/helpers/auth.ts)
const { newAccount, newEmail, post, removeAccounts, resetRateLimit } =
  authRequests('203.0.113.', 'change-email')

// Status and error code of POST /api/auth/change-email
function changeEmail(to: string, cookie?: string) {
  return answer(post('/change-email', { newEmail: to }, cookie))
}

// The list is read once from the environment (src/lib/instance.ts) and the
// test environment has none, so it is filled in place for this file
beforeAll(async () => {
  signupPolicy.domains.push(LISTED)
  await resetRateLimit()
})

afterAll(async () => {
  signupPolicy.domains.length = 0
  await resetRateLimit()
  await removeAccounts()
})

describe('/change-email with SIGNUP_EMAIL_DOMAINS', () => {
  // Better Auth's session check answers, the same way for every domain: the
  // list cannot be probed without an account
  test('says nothing about the list to a request without a session', async () => {
    const listed = await changeEmail(newEmail(LISTED))
    const foreign = await changeEmail(newEmail('gmail.example'))
    expect(listed.status).toBe(401)
    expect(foreign).toEqual(listed)
    // A cookie that is no session is no session
    expect(
      await changeEmail(
        newEmail('gmail.example'),
        'better-auth.session_token=x',
      ),
    ).toEqual(listed)
  })

  test('turns a foreign domain away for someone signed in', async () => {
    const { cookie } = await newAccount(LISTED)
    expect(await changeEmail(newEmail('gmail.example'), cookie)).toEqual({
      status: 403,
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    })
  })

  // An address that already has an account: Better Auth answers as if the
  // mail had gone out and sends none, so nothing is left to wait for
  test('lets a listed domain through for someone signed in', async () => {
    const { cookie } = await newAccount(LISTED)
    const taken = await newAccount(LISTED)
    expect((await changeEmail(taken.email, cookie)).status).toBe(200)
  })
})
