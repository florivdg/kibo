import { randomUUID } from 'node:crypto'

import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from 'astro:env/server'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { createEmailVerificationToken } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { and, desc, eq, inArray, like } from 'drizzle-orm'

import {
  account,
  member,
  organization,
  session,
  user,
  verification,
} from '@/db/schema'
import {
  EMAIL_CHANGE_CALLBACK,
  RESET_PASSWORD_PATH,
  VERIFY_EMAIL_CALLBACK,
} from '@/lib/auth-paths'
import {
  dropPasswordAndSessions,
  forgetResetTokens,
  passwordFormMode,
  passwordSetupToken,
  resetIdentifier,
} from '@/lib/password-setup'
import { EMAIL_CHANGE_DONE_CALLBACK } from '@/lib/verification-token'

import {
  answer,
  authRequests,
  PASSWORD,
  sessionCookie,
  type Account,
} from './helpers/auth'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// Confirming an address never makes a password usable that the mailbox's
// holder didn't set (src/lib/auth.ts, src/lib/password-setup.ts): anyone can
// sign up with someone else's address, and a second sign-up for it changes
// nothing. The handler as the browser calls it, against the local PostgreSQL.

// A benchmarking range no other file uses (tests/helpers/auth.ts)
const { get, newAccount, newEmail, post, removeAccounts, resetRateLimit } =
  authRequests('198.19.0.', 'verify-password')

const STRANGER_PASSWORD = 'passwort-eines-fremden-1'
const OWNER_PASSWORD = 'passwort-der-inhaberin-2'
const kitas: string[] = []

beforeAll(resetRateLimit)
// The sign-in budget per account and the mail budgets
beforeEach(resetSpamCounters)

afterAll(async () => {
  await resetRateLimit()
  await resetSpamCounters()
  await testDb.delete(organization).where(inArray(organization.id, kitas))
  await removeAccounts()
})

function signUp(email: string, password: string, name = 'Bea Beispiel') {
  return post('/sign-up/email', {
    name,
    email,
    password,
    callbackURL: VERIFY_EMAIL_CALLBACK,
  })
}

function signIn(email: string, password: string) {
  return post('/sign-in/email', { email, password })
}

async function accountOf(email: string) {
  const [row] = await testDb
    .select({ id: user.id, name: user.name, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
  return row
}

async function passwordHashOf(userId: string) {
  const [row] = await testDb
    .select({ password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    )
  return row?.password
}

function resetRowsOf(userId: string) {
  return testDb
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(
      and(
        like(verification.identifier, resetIdentifier('%')),
        eq(verification.value, userId),
      ),
    )
    .orderBy(desc(verification.createdAt))
}

function sessionsOf(userId: string) {
  return testDb
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
}

// The link Better Auth mails for a sign-up (sendVerificationEmailFn), built
// with its own function and the test secret
async function confirmationLink(
  email: string,
  {
    secret = BETTER_AUTH_SECRET,
    expiresIn = 3600,
    userId,
  }: { secret?: string; expiresIn?: number; userId?: string } = {},
) {
  const token = await createEmailVerificationToken(
    secret,
    email,
    undefined,
    expiresIn,
    { userId: userId ?? (await accountOf(email))!.id },
  )
  return `/verify-email?token=${token}&callbackURL=${encodeURIComponent(VERIFY_EMAIL_CALLBACK)}`
}

// Where opening a link leads: the Location of the redirect
async function open(link: string, cookie?: string) {
  const opened = await get(link, cookie)
  expect(opened.status).toBe(302)
  return opened.headers.get('location') ?? ''
}

// Opens the address's confirmation link (`link`, or a fresh one), which must
// lead to the form to set the first password: that form's token
async function setupFormFor(email: string, link?: string) {
  const location = await open(link ?? (await confirmationLink(email)))
  const url = new URL(location, BETTER_AUTH_URL)
  expect(url.pathname).toBe(RESET_PASSWORD_PATH)
  const token = url.searchParams.get('token')
  if (!token) throw new Error(`Kein Token in ${url.href}`)
  return token
}

function setPassword(token: string, newPassword: string) {
  return post('/reset-password', { token, newPassword })
}

// A sign-up whose confirmation link was opened: confirmed, without a
// password, with the token of the form
async function confirmedWithoutPassword(email = newEmail()) {
  expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
  const token = await setupFormFor(email)
  // The page behind it words the form as setting the first password
  expect(await passwordFormMode(token)).toBe('setup')
  return { email, token, id: (await accountOf(email))!.id }
}

// The newest reset token "Passwort vergessen" left for the account
async function requestedResetToken(email: string, userId: string) {
  const requested = await post('/request-password-reset', {
    email,
    redirectTo: RESET_PASSWORD_PATH,
  })
  expect(requested.status).toBe(200)
  const [row] = await resetRowsOf(userId)
  return row!.identifier.slice(resetIdentifier('').length)
}

const WRONG = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }
const LINK_VOID = { status: 400, code: 'INVALID_TOKEN' }
const UNCONFIRMED = { status: 403, code: 'EMAIL_NOT_VERIFIED' }

describe('a sign-up by someone who doesn’t hold the mailbox', () => {
  test('never gets its password confirmed', async () => {
    const email = newEmail()
    expect((await signUp(email, STRANGER_PASSWORD, 'Fremd')).status).toBe(200)
    // The holder of the address signs up too: Better Auth answers it like a
    // new account and keeps the first password
    const second = await signUp(email, OWNER_PASSWORD, 'Inhaberin')
    expect(second.status).toBe(200)
    const { id } = (await accountOf(email))!
    expect(await passwordHashOf(id)).toBeString()
    // A session the account can't get through Kibo, there to see it go
    await testDb.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    expect(await sessionsOf(id)).toHaveLength(1)

    // The holder opens the (resent) link: confirmed, and on to setting the
    // password — the password the stranger set is gone, as is every session
    const token = await setupFormFor(email)
    expect(await accountOf(email)).toMatchObject({ emailVerified: true })
    expect(await passwordHashOf(id)).toBeNull()
    expect(await sessionsOf(id)).toEqual([])
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(WRONG)
    expect(await answer(signIn(email, OWNER_PASSWORD))).toEqual(WRONG)

    // The holder sets theirs through the form
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(WRONG)
  })

  test('can’t accept an invitation for the address', async () => {
    const owner = await newAccount()
    const created = await post(
      '/organization/create',
      { name: 'Kita Regenbogen', slug: `kita-${randomUUID().slice(0, 18)}` },
      owner.cookie,
    )
    expect(created.status).toBe(200)
    const kita = String(created.data?.id)
    kitas.push(kita)
    const email = newEmail()
    const invited = await post(
      '/organization/invite-member',
      { email, role: 'admin', organizationId: kita },
      owner.cookie,
    )
    expect(invited.status).toBe(200)
    const invitationId = String(invited.data?.id)

    // Registered first, by someone who guessed who would be invited
    expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
    expect((await signUp(email, OWNER_PASSWORD)).status).toBe(200)
    const token = await setupFormFor(email)

    // The stranger's password signs nobody in, so there is no session to
    // accept with
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(WRONG)
    const { id } = (await accountOf(email))!
    expect(await sessionsOf(id)).toEqual([])

    // The invitation is the mailbox holder's, once they set their password
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    const cookie = await sessionCookie(email, OWNER_PASSWORD)
    expect(
      await answer(
        post('/organization/accept-invitation', { invitationId }, cookie),
      ),
    ).toEqual({ status: 200, code: undefined })
    const members = await testDb
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, kita))
    expect(members).toContainEqual({ userId: id, role: 'admin' })
  })

  test('changes nothing once the holder has set the password', async () => {
    const { email, token, id } = await confirmedWithoutPassword()
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    const hash = await passwordHashOf(id)

    // Signing up again answers like before and touches nothing
    const again = await signUp(email, STRANGER_PASSWORD, 'Fremd')
    expect(again.status).toBe(200)
    expect(await accountOf(email)).toMatchObject({
      name: 'Bea Beispiel',
      emailVerified: true,
    })
    expect(await passwordHashOf(id)).toBe(hash)
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(WRONG)
  })
})

describe('a confirmation racing the sign-up or a reset', () => {
  test('confirms nothing while the sign-up has no credential yet', async () => {
    // A link opened between Better Auth's writes of the user and its
    // credential (dropPasswordAndSessions in src/lib/password-setup.ts), or
    // for an account that lost its credential row
    const email = newEmail()
    expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
    const { id } = (await accountOf(email))!
    await testDb.delete(account).where(eq(account.userId, id))

    expect(await open(await confirmationLink(email))).toBe(
      `${VERIFY_EMAIL_CALLBACK}&error=INVALID_TOKEN`,
    )
    expect(await accountOf(email)).toMatchObject({ emailVerified: false })
    expect(await resetRowsOf(id)).toEqual([])

    // A credential stored afterwards isn't confirmed by that link either
    await testDb.insert(account).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: await hashPassword(STRANGER_PASSWORD),
    })
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(UNCONFIRMED)

    // "Passwort vergessen" still gets the mailbox holder in, and confirms
    const token = await requestedResetToken(email, id)
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    expect(await accountOf(email)).toMatchObject({ emailVerified: true })
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
  })

  test('keeps the password a reset set after Better Auth looked', async () => {
    // Better Auth read the account as unconfirmed, then a reset confirmed it
    // before the hook ran: under the lock it is left as it is
    const email = newEmail()
    expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
    const { id } = (await accountOf(email))!
    const token = await requestedResetToken(email, id)
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    const hash = await passwordHashOf(id)
    await sessionCookie(email, OWNER_PASSWORD)

    expect(await dropPasswordAndSessions(id)).toBe('confirmable')
    expect(await passwordHashOf(id)).toBe(hash)
    expect(await sessionsOf(id)).toHaveLength(1)
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
  })

  test('confirms nothing for an account that is gone', async () => {
    // Purged between Better Auth's read and the hook: the link is turned
    // away, so Better Auth never confirms by address
    expect(await dropPasswordAndSessions(`gone-${randomUUID()}`)).toBe(
      'no-credential',
    )
  })

  test('makes no setup link once the account has a password', async () => {
    const { email, token, id } = await confirmedWithoutPassword()
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    expect(await passwordSetupToken({ email, userId: id })).toBeUndefined()
    expect(await resetRowsOf(id)).toEqual([])
  })

  test('a saved password voids every other reset or setup link', async () => {
    const { email, token: setup, id } = await confirmedWithoutPassword()
    const reset = await requestedResetToken(email, id)
    expect((await setPassword(reset, OWNER_PASSWORD)).status).toBe(200)
    expect(await resetRowsOf(id)).toEqual([])
    expect(await answer(setPassword(setup, STRANGER_PASSWORD))).toEqual(
      LINK_VOID,
    )
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
  })
})

describe('signing up honestly', () => {
  test('ends with the password the mailbox holder chose', async () => {
    const email = newEmail()
    // The form sends a random password nobody knows (SignupForm.vue)
    const throwaway = randomUUID()
    expect((await signUp(email, throwaway)).status).toBe(200)
    // Not before the address is confirmed
    expect(await answer(signIn(email, throwaway))).toEqual(UNCONFIRMED)
    const token = await setupFormFor(email)
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
    expect(await answer(signIn(email, throwaway))).toEqual(WRONG)
  })

  test('opening the link again keeps the open form, until a password is set', async () => {
    const { email, token: first, id } = await confirmedWithoutPassword()
    const link = await confirmationLink(email)

    // Better Auth's "already confirmed": still no password, so a new form —
    // and the one already open (a double click, a mail scanner) still works
    const second = await setupFormFor(email, link)
    expect(second).not.toBe(first)
    expect(await resetRowsOf(id)).toHaveLength(2)
    expect((await setPassword(first, OWNER_PASSWORD)).status).toBe(200)
    // Saving voids the other one
    expect(await resetRowsOf(id)).toEqual([])
    expect(await answer(setPassword(second, STRANGER_PASSWORD))).toEqual(
      LINK_VOID,
    )

    // With a password the link says "confirmed", as it always did
    expect(await open(link)).toBe(VERIFY_EMAIL_CALLBACK)
    expect(await resetRowsOf(id)).toEqual([])
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
  })

  test('a forged or expired link leads to no form', async () => {
    const { email, id } = await confirmedWithoutPassword()
    await forgetResetTokens(id, testDb)

    const forged = await open(
      await confirmationLink(email, { secret: 'y'.repeat(40) }),
    )
    expect(forged).toBe(`${VERIFY_EMAIL_CALLBACK}&error=INVALID_TOKEN`)
    const expired = await open(
      await confirmationLink(email, { expiresIn: -60 }),
    )
    expect(expired).toBe(`${VERIFY_EMAIL_CALLBACK}&error=TOKEN_EXPIRED`)
    // Signed, but for another account than the address has
    const otherAccount = await open(
      await confirmationLink(email, { userId: `other-${randomUUID()}` }),
    )
    expect(otherAccount).toBe(`${VERIFY_EMAIL_CALLBACK}&error=INVALID_TOKEN`)
    expect(await resetRowsOf(id)).toEqual([])
  })
})

describe('"Passwort vergessen"', () => {
  test('sets the password of a confirmed account that has none', async () => {
    const { email, id } = await confirmedWithoutPassword()
    const token = await requestedResetToken(email, id)
    // The page words it as setting the first password, like the form the
    // confirmation link led to
    expect(await passwordFormMode(token)).toBe('setup')
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
    // A used or unknown token names no account: worded as a reset
    expect(await passwordFormMode(token)).toBe('reset')
    expect(await passwordFormMode(randomUUID())).toBe('reset')

    // With a password it is a reset again
    expect(await passwordFormMode(await requestedResetToken(email, id))).toBe(
      'reset',
    )
  })

  test('confirms the address, and the confirmation link keeps that password', async () => {
    const email = newEmail()
    expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
    const { id } = (await accountOf(email))!
    const token = await requestedResetToken(email, id)
    expect((await setPassword(token, OWNER_PASSWORD)).status).toBe(200)

    expect(await accountOf(email)).toMatchObject({ emailVerified: true })
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
    expect(await answer(signIn(email, STRANGER_PASSWORD))).toEqual(WRONG)
    // Opening the confirmation link afterwards drops nothing
    expect(await open(await confirmationLink(email))).toBe(
      VERIFY_EMAIL_CALLBACK,
    )
    expect((await signIn(email, OWNER_PASSWORD)).status).toBe(200)
  })
})

describe('changing the address', () => {
  test('keeps the password, and neither link leads to a form', async () => {
    const owner: Account = await newAccount()
    const hash = await passwordHashOf(owner.id)
    const newAddress = newEmail()
    const callbackURL = '/admin/account?emailChange=1'
    const link = async (requestType: string) => {
      const token = await createEmailVerificationToken(
        BETTER_AUTH_SECRET,
        owner.email,
        newAddress,
        3600,
        { requestType, userId: owner.id },
      )
      return `/verify-email?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`
    }

    // The current address agrees …
    const agreed = await open(
      await link('change-email-confirmation'),
      owner.cookie,
    )
    expect(agreed).toBe(callbackURL)
    // … and the new one is confirmed, in the signed-in browser
    const changed = await open(
      await link('change-email-verification'),
      owner.cookie,
    )
    expect(changed).toBe(callbackURL)

    expect(await accountOf(newAddress)).toMatchObject({
      id: owner.id,
      emailVerified: true,
    })
    expect(await passwordHashOf(owner.id)).toBe(hash)
    expect(await resetRowsOf(owner.id)).toEqual([])
    expect((await signIn(newAddress, PASSWORD)).status).toBe(200)
  })
})

// Callbacks whose origin is the site's own once normalised, which Better
// Auth lets through, but whose path normalises to a protocol-relative one
const ESCAPING_CALLBACKS = [
  '/admin/..//evil.example',
  '/..//evil.example',
  '/admin/%2e%2e//evil.example',
  '//evil.example',
]

// A redirect that stays in the admin area, with the given reason
function expectAdminRejection(location: string, error: string) {
  expect(location).toStartWith('/admin')
  expect(location).not.toStartWith('//')
  expect(new URL(location, BETTER_AUTH_URL).origin).toBe(
    new URL(BETTER_AUTH_URL).origin,
  )
  expect(new URL(location, BETTER_AUTH_URL).searchParams.get('error')).toBe(
    error,
  )
}

function linkWith(token: string, callbackURL: string) {
  return `/verify-email?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`
}

describe('a rejected address change link', () => {
  // requireSessionForEmailChange in src/lib/auth.ts turns the last link away
  // without a session before Better Auth checks its signature, so an unsigned
  // token reaches the redirect
  const payload = () =>
    Buffer.from(
      JSON.stringify({
        requestType: 'change-email-verification',
        email: newEmail(),
        updateTo: newEmail(),
      }),
    ).toString('base64url')

  test('leads back to its own callback page', async () => {
    const location = await open(
      linkWith(`x.${payload()}.y`, EMAIL_CHANGE_DONE_CALLBACK),
    )
    expect(location).toBe(
      `${EMAIL_CHANGE_DONE_CALLBACK}&error=EMAIL_CHANGE_NEEDS_SESSION`,
    )
  })

  test('leads back into the admin area, never off the site', async () => {
    for (const callbackURL of [...ESCAPING_CALLBACKS, '/admin/%2e%2e//x']) {
      const location = await open(linkWith(`x.${payload()}.y`, callbackURL))
      expectAdminRejection(location, 'INVALID_TOKEN')
    }
  })
})

// requireAdminCallback in src/lib/auth.ts: Better Auth would answer these
// with 'Location: //evil.example?error=…'
describe('a link with a crafted callback', () => {
  test('leads into the admin area whatever its token', async () => {
    const email = newEmail()
    const expired = await createEmailVerificationToken(
      BETTER_AUTH_SECRET,
      email,
      undefined,
      -60,
      { userId: `user-${randomUUID()}` },
    )
    for (const token of ['garbage', expired]) {
      for (const callbackURL of ESCAPING_CALLBACKS) {
        expectAdminRejection(
          await open(linkWith(token, callbackURL)),
          'INVALID_TOKEN',
        )
      }
    }
  })

  test('confirms nothing even with a valid token', async () => {
    const email = newEmail()
    expect((await signUp(email, STRANGER_PASSWORD)).status).toBe(200)
    const link = new URL(await confirmationLink(email), BETTER_AUTH_URL)
    const location = await open(
      linkWith(link.searchParams.get('token')!, '/..//evil.example'),
    )
    expectAdminRejection(location, 'INVALID_TOKEN')
    expect((await accountOf(email))!.emailVerified).toBe(false)
  })

  test('leaves Kibo’s own callbacks as they are', async () => {
    for (const callbackURL of [
      VERIFY_EMAIL_CALLBACK,
      EMAIL_CHANGE_CALLBACK,
      EMAIL_CHANGE_DONE_CALLBACK,
    ]) {
      expect(await open(linkWith('garbage', callbackURL))).toBe(
        `${callbackURL}&error=INVALID_TOKEN`,
      )
    }
  })
})

describe('a failed reset', () => {
  test('logs no token', async () => {
    // PostgreSQL refuses a NUL in text: the lookup of the reset link's
    // account fails with the token among the query's parameters
    const token = `geheim-${randomUUID()}\u0000`
    const logged: unknown[] = []
    const spy = spyOn(console, 'error').mockImplementation((...args) => {
      logged.push(...args)
    })
    try {
      const failed = await setPassword(token, OWNER_PASSWORD)
      expect(failed.status).toBe(500)
    } finally {
      spy.mockRestore()
    }
    expect(logged.length).toBeGreaterThan(0)
    const text = logged
      .map((entry) =>
        entry instanceof Error
          ? `${entry.message} ${entry.stack} ${String(entry.cause)}`
          : String(entry),
      )
      .join('\n')
    expect(text).not.toContain('geheim-')
  })
})
