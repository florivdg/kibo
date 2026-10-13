import { describe, expect, test } from 'bun:test'
import { betterAuth } from 'better-auth'

import { authOptions, ORGANIZATION_PATHS_IN_USE } from '@/lib/auth-options'
import { PASSKEY_PATHS_IN_USE } from '@/lib/passkeys/rules'

// betterAuth() needs no database to expose its routes; the options are the
// same ones the app and the schema generator use.
const auth = betterAuth({
  ...authOptions,
  baseURL: 'http://localhost:4321',
  secret: 'x'.repeat(32),
})

const routes = new Set(
  Object.values(auth.api)
    .map((endpoint) => (endpoint as { path?: string }).path)
    .filter((path): path is string => typeof path === 'string'),
)

describe('rate limit rules', () => {
  // A rule for a path that does not exist is silently ignored by Better Auth,
  // so a typo (or a renamed route after an upgrade) would quietly switch the
  // limit off — /forget-password did exactly that
  test('every custom rule names a route that exists', () => {
    const named = Object.keys(authOptions.rateLimit.customRules)
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((path) => !routes.has(path))).toEqual([])
  })

  test('covers the endpoints that send mail or guess credentials', () => {
    const named = Object.keys(authOptions.rateLimit.customRules)
    for (const path of [
      '/sign-up/email',
      '/send-verification-email',
      '/request-password-reset',
      '/reset-password',
      '/two-factor/verify-totp',
      '/two-factor/verify-backup-code',
      '/change-email',
      '/organization/invite-member',
    ]) {
      expect(named).toContain(path)
    }
  })

  // Every route that takes the current password is a way to guess it, and
  // none may be faster at that than the login page
  test('limits every route that checks a password like the login', () => {
    const rules = authOptions.rateLimit.customRules as Record<
      string,
      { window: number; max: number }
    >
    const login = rules['/sign-in/email']!
    for (const path of [
      '/sign-in/email',
      '/change-password',
      '/delete-user',
      '/verify-password',
      '/two-factor/enable',
      '/two-factor/disable',
      '/two-factor/get-totp-uri',
      '/two-factor/generate-backup-codes',
      // Adding a passkey asks for the password, signing in with one makes a
      // session (checkPasskeyRegistration in src/lib/auth.ts)
      '/passkey/verify-registration',
      '/passkey/verify-authentication',
    ]) {
      expect(routes.has(path)).toBe(true)
      expect(rules[path]).toEqual(login)
    }
    expect(login.max / login.window).toBeLessThanOrEqual(10 / 600)
  })

  test('stores its counters where all processes see them', () => {
    expect(authOptions.rateLimit.enabled).toBe(true)
    expect(authOptions.rateLimit.storage).toBe('database')
  })
})

const disabled = authOptions.disabledPaths

describe('plugin endpoints', () => {
  // After an upgrade a new route of the plugin would otherwise be reachable
  // without anyone having decided so
  for (const [prefix, inUse] of [
    ['/organization/', ORGANIZATION_PATHS_IN_USE],
    ['/passkey/', PASSKEY_PATHS_IN_USE],
  ] as const) {
    const pluginRoutes = [...routes].filter((path) => path.startsWith(prefix))

    test(`every ${prefix} route is either in use or switched off`, () => {
      expect(pluginRoutes.length).toBeGreaterThan(0)
      const undecided = pluginRoutes.filter(
        (path) => !inUse.includes(path) && !disabled.includes(path),
      )
      expect(undecided).toEqual([])
    })

    test(`keeps the ${prefix} routes the app uses`, () => {
      for (const path of inUse) {
        expect(routes.has(path)).toBe(true)
        expect(disabled).not.toContain(path)
      }
    })
  }

  test('switches off only routes that exist', () => {
    expect(disabled.filter((path) => !routes.has(path))).toEqual([])
  })
})

describe('organization endpoints', () => {
  // Roles never change, a Kita is never deleted through the API, and
  // members and invitations are listed by the pages, not by a route
  test('switches off what the app has no use for', () => {
    for (const path of [
      '/organization/update-member-role',
      '/organization/delete',
      '/organization/list-members',
      '/organization/list-invitations',
      '/organization/list-user-invitations',
      '/organization/get-invitation',
    ]) {
      expect(disabled).toContain(path)
    }
  })

  test('uses exactly the invitation and member routes the UI calls', () => {
    for (const path of [
      '/organization/invite-member',
      '/organization/cancel-invitation',
      '/organization/accept-invitation',
      '/organization/reject-invitation',
      '/organization/remove-member',
      '/organization/leave',
    ]) {
      expect(ORGANIZATION_PATHS_IN_USE).toContain(path)
    }
  })

  test('answers a switched-off route with 404', async () => {
    const response = await auth.handler(
      new Request(
        'http://localhost:4321/api/auth/organization/update-member-role',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      ),
    )
    expect(response.status).toBe(404)
  })
})
