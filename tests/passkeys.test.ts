import { randomUUID } from 'node:crypto'

import { BETTER_AUTH_URL } from 'astro:env/server'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createAuthMiddleware } from 'better-auth/api'
import { eq, sql } from 'drizzle-orm'

import { passkey, session, verification } from '@/db/schema'
import { auth } from '@/lib/auth'
import {
  PASSKEY_NAME_MAX,
  PASSKEYS_PER_ACCOUNT,
  PASSWORD_MAX_LENGTH,
} from '@/lib/limits'
import {
  afterAuthentication,
  afterRegistration,
  type PasskeyLookupContext,
} from '@/lib/passkeys/rules'
import { passkeyTransaction } from '@/lib/passkeys/transactions'

import { apiRefusal } from './helpers/api-error'
import { answer, authRequests, PASSWORD, type Account } from './helpers/auth'
import { cookiesOf, softwarePasskey } from './helpers/passkey'
import { testDb } from './helpers/spam-db'

// Passkeys (src/lib/passkeys/, checkPasskeyRegistration and onPasswordReset
// in src/lib/auth.ts) against the local PostgreSQL. No authenticator is
// needed: what Kibo adds runs before the plugin looks at a WebAuthn response,
// or after it was verified, where the tests hand in what it would have found.

// The benchmarking network is this file's (tests/helpers/auth.ts)
const { get, newAccount, post, removeAccounts, resetRateLimit } = authRequests(
  '198.18.0.',
  'passkey',
)

// A row as the plugin stores it; the key itself is never looked at here
async function addPasskeyRow(userId: string) {
  const id = randomUUID()
  await testDb.insert(passkey).values({
    id,
    userId,
    publicKey: 'cHVibGljLWtleQ',
    credentialID: `credential-${id}`,
    counter: 0,
    deviceType: 'multiDevice',
    backedUp: true,
    createdAt: new Date(),
  })
  return id
}

function passkeysOf(userId: string) {
  return testDb.select().from(passkey).where(eq(passkey.userId, userId))
}

async function resetTokenFor(owner: Account) {
  const token = randomUUID()
  await testDb.insert(verification).values({
    id: randomUUID(),
    identifier: `reset-password:${token}`,
    value: owner.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return token
}

async function registrationFor(owner: Account, key = softwarePasskey()) {
  const options = await get('/passkey/generate-register-options', owner.cookie)
  expect(options.status).toBe(200)
  return {
    key,
    cookie: `${owner.cookie}; ${cookiesOf(options.headers)}`,
    body: {
      password: PASSWORD,
      response: key.register(options.data!.challenge as string),
    },
  }
}

function pauseRequest() {
  const reached = Promise.withResolvers<number>()
  const released = Promise.withResolvers<void>()
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    async pause() {
      const on = (await passkeyTransaction.get()) ?? testDb
      const { rows } = await on.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      )
      reached.resolve(rows[0]!.pid)
      await released.promise
    },
  }
}

// Wait for Postgres to report that the overlapping request is blocked by the
// held transaction, or fail if it completes early. No timing assumption about
// how long password hashing or the handler takes.
async function expectBlockedBy(pid: number, request: Promise<unknown>) {
  let completed = false
  const finish = () => {
    completed = true
  }
  void request.then(finish, finish)
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    expect(completed).toBe(false)
    const { rows } = await testDb.execute<{ blocked: boolean }>(sql`
      select exists (
        select 1 from pg_stat_activity
        where ${pid} = any(pg_blocking_pids(pid))
      ) as blocked
    `)
    if (rows[0]!.blocked) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    'The overlapping request did not wait for the credential lock',
  )
}

let account: Account

describe('the plugin as the app runs it', () => {
  // What the checks below rely on, read from the live configuration rather
  // than from the options module, so a lost override shows up here
  const plugin = auth.options.plugins.find((p) => p.id === 'passkey')

  test('is wired to Kibo’s origin, checks and schema', () => {
    if (plugin?.id !== 'passkey') throw new Error('no passkey plugin')
    expect(plugin.options?.origin).toBe(new URL(BETTER_AUTH_URL).origin)
    expect(plugin.options?.registration?.afterVerification).toBe(
      afterRegistration,
    )
    expect(plugin.options?.authentication?.afterVerification).toBe(
      afterAuthentication,
    )
    expect(plugin.options?.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    })
    expect(plugin.schema.passkey.fields.credentialID.unique).toBe(true)
  })

  test('the database refuses a second passkey with the same credential id', async () => {
    const owner = await newAccount()
    const id = await addPasskeyRow(owner.id)
    const [row] = await passkeysOf(owner.id)
    expect(row?.id).toBe(id)
    const duplicate = testDb
      .insert(passkey)
      .values({ ...row!, id: randomUUID() })
      .then(
        () => undefined,
        (error: { cause?: { code?: string } }) => error.cause?.code,
      )
    // unique_violation
    expect(await duplicate).toBe('23505')
    expect(await passkeysOf(owner.id)).toHaveLength(1)
  })
})

beforeAll(async () => {
  await resetRateLimit()
  account = await newAccount()
})

afterAll(async () => {
  await removeAccounts()
  await resetRateLimit()
})

describe('adding a passkey', () => {
  // The last step of the registration; without a challenge cookie the
  // plugin's first own check fails, so a request that gets that far has
  // passed Kibo's hook
  function register(body: Record<string, unknown>, cookie?: string) {
    return answer(
      post('/passkey/verify-registration', { response: {}, ...body }, cookie),
    )
  }

  test('without a session is the plugin’s 401', async () => {
    expect((await register({ password: PASSWORD })).status).toBe(401)
  })

  test('asks for the current password', async () => {
    const invalid = { status: 400, code: 'INVALID_PASSWORD' }
    expect(await register({}, account.cookie)).toEqual(invalid)
    expect(await register({ password: '' }, account.cookie)).toEqual(invalid)
    expect(await register({ password: 123 }, account.cookie)).toEqual(invalid)
    expect(
      await register({ password: 'ein-ganz-anderes-passwort' }, account.cookie),
    ).toEqual(invalid)
    // Better Auth's own check, which says so
    expect(
      await register(
        { password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) },
        account.cookie,
      ),
    ).toEqual({ status: 400, code: 'PASSWORD_TOO_LONG' })
  })

  test('checks the name', async () => {
    for (const name of ['x'.repeat(PASSKEY_NAME_MAX + 1), 'Laptop\nBüro', 7]) {
      expect(
        await register({ password: PASSWORD, name }, account.cookie),
      ).toEqual({ status: 400, code: 'INVALID_PASSKEY_NAME' })
    }
    // Before the password, which costs a hash
    expect(await register({ name: 7 }, account.cookie)).toEqual({
      status: 400,
      code: 'INVALID_PASSKEY_NAME',
    })
  })

  test('with the password and a valid or blank name the plugin goes on', async () => {
    for (const name of [undefined, '', '   ', 'Laptop im Büro']) {
      expect(
        await register({ password: PASSWORD, name }, account.cookie),
      ).toEqual({ status: 400, code: 'CHALLENGE_NOT_FOUND' })
    }
  })

  test(`stops at ${PASSKEYS_PER_ACCOUNT} passkeys`, async () => {
    const full = await newAccount()
    for (let i = 0; i < PASSKEYS_PER_ACCOUNT - 1; i++) {
      await addPasskeyRow(full.id)
    }
    expect(await register({ password: PASSWORD }, full.cookie)).toEqual({
      status: 400,
      code: 'CHALLENGE_NOT_FOUND',
    })
    await addPasskeyRow(full.id)
    expect(await register({ password: PASSWORD }, full.cookie)).toEqual({
      status: 400,
      code: 'PASSKEY_LIMIT_REACHED',
    })
  })

  // Bound to BETTER_AUTH_URL, not to whatever the request says
  test('creates the options for the instance’s own address', async () => {
    const { status, data } = await get(
      '/passkey/generate-register-options',
      account.cookie,
    )
    expect(status).toBe(200)
    expect(data?.rp).toEqual({ name: 'Kibo', id: 'localhost' })
    // The account's address names the passkey in the keychain
    expect(data?.user).toMatchObject({ name: account.email })
    expect(data?.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    })
  })
})

describe('after the authenticator answered', () => {
  test('a registration without user verification is refused', () => {
    expect(() =>
      afterRegistration({
        verification: { registrationInfo: { userVerified: false } },
      }),
    ).toThrow(
      expect.objectContaining({
        statusCode: 400,
        body: expect.objectContaining({
          code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
        }),
      }),
    )
    expect(() =>
      afterRegistration({
        verification: { registrationInfo: { userVerified: true } },
      }),
    ).not.toThrow()
  })

  // The plugin's lookups, answered by the test
  function lookup(
    found: { userId: string } | null,
    user: { emailVerified: boolean } | null,
  ): PasskeyLookupContext & { asked: unknown[] } {
    const asked: unknown[] = []
    return {
      asked,
      context: {
        adapter: {
          findOne: async <T>(query: unknown) => {
            asked.push(query)
            return found as T | null
          },
        },
        internalAdapter: {
          findUserById: async (userId: string) => {
            asked.push(userId)
            return user
          },
        },
      },
    }
  }

  async function signIn(userVerified: boolean, ctx: PasskeyLookupContext) {
    try {
      await afterAuthentication({
        ctx,
        verification: { authenticationInfo: { userVerified } },
        clientData: { id: 'credential-1' },
      })
    } catch (error) {
      return apiRefusal(error)
    }
  }

  test('a sign-in without user verification is refused', async () => {
    const ctx = lookup({ userId: 'u' }, { emailVerified: true })
    expect(await signIn(false, ctx)).toEqual({
      status: 401,
      code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
    })
    expect(ctx.asked).toEqual([])
  })

  test('a sign-in to an unconfirmed address is refused like the login', async () => {
    const ctx = lookup({ userId: 'u' }, { emailVerified: false })
    expect(await signIn(true, ctx)).toEqual({
      status: 403,
      code: 'EMAIL_NOT_VERIFIED',
    })
    expect(ctx.asked).toEqual([
      {
        model: 'passkey',
        where: [{ field: 'credentialID', value: 'credential-1' }],
      },
      'u',
    ])
  })

  test('a passkey or account gone in between is not found', async () => {
    const notFound = { status: 401, code: 'PASSKEY_NOT_FOUND' }
    expect(await signIn(true, lookup(null, null))).toEqual(notFound)
    expect(await signIn(true, lookup({ userId: 'u' }, null))).toEqual(notFound)
  })

  test('a verified passkey of a confirmed account passes', async () => {
    const ctx = lookup({ userId: 'u' }, { emailVerified: true })
    expect(await signIn(true, ctx)).toBeUndefined()
  })
})

describe('signing in with a passkey', () => {
  test('hands out a challenge without a session', async () => {
    const { status, data, headers } = await get(
      '/passkey/generate-authenticate-options',
    )
    expect(status).toBe(200)
    expect(data?.rpId).toBe('localhost')
    expect(headers.getSetCookie().join()).toContain('better-auth-passkey')
  })

  test('without the challenge cookie there is nothing to verify', async () => {
    expect(
      await answer(
        post('/passkey/verify-authentication', {
          response: { id: 'credential-1' },
        }),
      ),
    ).toEqual({ status: 400, code: 'CHALLENGE_NOT_FOUND' })
  })
})

describe('removing a passkey', () => {
  test('only the account’s own', async () => {
    const owner = await newAccount()
    const id = await addPasskeyRow(owner.id)
    expect(
      (await answer(post('/passkey/delete-passkey', { id }, account.cookie)))
        .status,
    ).toBe(401)
    expect(await passkeysOf(owner.id)).toHaveLength(1)
    expect(
      await answer(post('/passkey/delete-passkey', { id }, owner.cookie)),
    ).toEqual({ status: 200, code: undefined })
    expect(await passkeysOf(owner.id)).toEqual([])
  })
})

describe('a password reset', () => {
  test('waits for a verified registration, then removes its credential and session', async () => {
    const owner = await newAccount()
    const registration = await registrationFor(owner)
    const token = await resetTokenFor(owner)
    const plugin = auth.options.plugins.find((p) => p.id === 'passkey')!
    const hooks = plugin.options!.registration!
    const original = hooks.afterVerification!
    const held = pauseRequest()
    hooks.afterVerification = async (input) => {
      const result = await original(input)
      if (input.user.id === owner.id) await held.pause()
      return result
    }
    const registering = post(
      '/passkey/verify-registration',
      {
        ...registration.body,
        // This API option also creates a session, which must stay in the same
        // transaction and be revoked by the overlapping reset.
        createSession: true,
      },
      registration.cookie,
    )
    let resetting: ReturnType<typeof post> | undefined
    try {
      const pid = await held.reached
      resetting = post('/reset-password', {
        token,
        newPassword: 'ein-neues-langes-passwort',
      })
      await expectBlockedBy(pid, resetting)
      held.release()
      expect((await registering).status).toBe(200)
      expect((await resetting).status).toBe(200)
      expect(await passkeysOf(owner.id)).toEqual([])
      expect(
        await testDb.select().from(session).where(eq(session.userId, owner.id)),
      ).toEqual([])
      const options = await get('/passkey/generate-authenticate-options')
      expect(
        await answer(
          post(
            '/passkey/verify-authentication',
            {
              response: registration.key.authenticate(
                options.data!.challenge as string,
              ),
            },
            cookiesOf(options.headers),
          ),
        ),
      ).toEqual({ status: 401, code: 'PASSKEY_NOT_FOUND' })
    } finally {
      held.release()
      await Promise.allSettled([registering, resetting])
      hooks.afterVerification = original
    }
  }, 15_000)

  test('refuses a registration checked before a reset, even when the password stays the same', async () => {
    const owner = await newAccount()
    const registration = await registrationFor(owner)
    const token = await resetTokenFor(owner)
    const context = await auth.$context
    const hooks = context.options.hooks!
    const original = hooks.before!
    const held = pauseRequest()
    hooks.before = createAuthMiddleware(async (ctx) => {
      await original(ctx)
      if (
        ctx.path === '/passkey/verify-registration' &&
        ctx.context.session?.user.id === owner.id
      ) {
        await held.pause()
      }
    })
    const registering = post(
      '/passkey/verify-registration',
      registration.body,
      registration.cookie,
    )
    try {
      await held.reached
      expect(
        await answer(post('/reset-password', { token, newPassword: PASSWORD })),
      ).toEqual({ status: 200, code: undefined })
      held.release()
      expect((await registering).status).toBe(401)
      expect(await passkeysOf(owner.id)).toEqual([])
    } finally {
      held.release()
      await registering
      hooks.before = original
    }
  }, 15_000)

  test('waits for a verified passkey sign-in, then revokes its new session', async () => {
    const owner = await newAccount()
    const registration = await registrationFor(owner)
    expect(
      (
        await post(
          '/passkey/verify-registration',
          registration.body,
          registration.cookie,
        )
      ).status,
    ).toBe(200)
    const token = await resetTokenFor(owner)
    const options = await get('/passkey/generate-authenticate-options')
    const plugin = auth.options.plugins.find((p) => p.id === 'passkey')!
    const hooks = plugin.options!.authentication!
    const original = hooks.afterVerification!
    const held = pauseRequest()
    hooks.afterVerification = async (input) => {
      await original(input)
      if (input.clientData.id === registration.key.id) await held.pause()
    }
    const signingIn = post(
      '/passkey/verify-authentication',
      {
        response: registration.key.authenticate(
          options.data!.challenge as string,
        ),
      },
      cookiesOf(options.headers),
    )
    let resetting: ReturnType<typeof post> | undefined
    try {
      const pid = await held.reached
      resetting = post('/reset-password', {
        token,
        newPassword: 'ein-neues-langes-passwort',
      })
      await expectBlockedBy(pid, resetting)
      held.release()
      expect((await signingIn).status).toBe(200)
      expect((await resetting).status).toBe(200)
      expect(await passkeysOf(owner.id)).toEqual([])
      expect(
        await testDb.select().from(session).where(eq(session.userId, owner.id)),
      ).toEqual([])
    } finally {
      held.release()
      await Promise.allSettled([signingIn, resetting])
      hooks.afterVerification = original
    }
  }, 15_000)

  test('rolls back the password, reset token and cleanup together on failure', async () => {
    const owner = await newAccount()
    await addPasskeyRow(owner.id)
    const token = await resetTokenFor(owner)
    const context = await auth.$context
    const options = context.options.emailAndPassword!
    const original = options.onPasswordReset!
    options.onPasswordReset = async (input) => {
      await original(input)
      if (input.user.id === owner.id) throw new Error('simulated reset failure')
    }
    const body = { token, newPassword: 'ein-neues-langes-passwort' }
    try {
      // The core endpoint also accepts a query token when the body token is
      // empty. That path must take the same transaction and account lock.
      await auth.api
        .resetPassword({ body: { ...body, token: '' }, query: { token } })
        .then(
          () => {
            throw new Error('Reset unexpectedly succeeded')
          },
          (error: unknown) =>
            expect(error).toEqual(new Error('simulated reset failure')),
        )
      expect(await passkeysOf(owner.id)).toHaveLength(1)
      expect(
        (await post('/verify-password', { password: PASSWORD }, owner.cookie))
          .status,
      ).toBe(200)
      expect(
        await testDb
          .select()
          .from(verification)
          .where(eq(verification.identifier, `reset-password:${token}`)),
      ).toHaveLength(1)
    } finally {
      options.onPasswordReset = original
    }
    expect(await auth.api.resetPassword({ body })).toEqual({ status: true })
    expect(await passkeysOf(owner.id)).toEqual([])
  }, 15_000)

  test('removes the account’s passkeys, not those of others', async () => {
    const owner = await newAccount()
    const other = await newAccount()
    await addPasskeyRow(owner.id)
    await addPasskeyRow(owner.id)
    await addPasskeyRow(other.id)
    // What the link in the reset mail carries
    const token = await resetTokenFor(owner)

    expect(
      await answer(
        post('/reset-password', {
          token,
          newPassword: 'ein-neues-langes-passwort',
        }),
      ),
    ).toEqual({ status: 200, code: undefined })
    expect(await passkeysOf(owner.id)).toEqual([])
    expect(await passkeysOf(other.id)).toHaveLength(1)
    // … before the sessions go, as they did before
    const sessions = await testDb
      .select()
      .from(session)
      .where(eq(session.userId, owner.id))
    expect(sessions).toEqual([])
  })

  test('changing the password keeps them', async () => {
    const owner = await newAccount()
    await addPasskeyRow(owner.id)
    expect(
      await answer(
        post(
          '/change-password',
          {
            currentPassword: PASSWORD,
            newPassword: 'ein-neues-langes-passwort',
          },
          owner.cookie,
        ),
      ),
    ).toEqual({ status: 200, code: undefined })
    expect(await passkeysOf(owner.id)).toHaveLength(1)
  })
})
