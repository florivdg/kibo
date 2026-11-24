import { describe, expect, test } from 'bun:test'

import {
  adminRedirectTarget,
  isAdminRedirect,
  linkErrorRedirect,
  loginUrl,
  needsOrganization,
} from '@/lib/admin-redirect'
import { EMAIL_CHANGE_CALLBACK, VERIFY_EMAIL_CALLBACK } from '@/lib/auth-paths'
import { EMAIL_CHANGE_DONE_CALLBACK } from '@/lib/verification-token'

describe('linkErrorRedirect', () => {
  test('keeps the callback page and appends the reason', () => {
    expect(linkErrorRedirect('/admin/account?emailChange=1', 'X')).toBe(
      '/admin/account?emailChange=1&error=X',
    )
  })

  test('never leaves the admin area', () => {
    expect(linkErrorRedirect('https://evil.example/admin', 'X')).toBe(
      '/admin?error=X',
    )
    expect(linkErrorRedirect(undefined, 'X')).toBe('/admin?error=X')
  })

  // Checked after the parser normalised the path, which is what the browser
  // follows: these start with /admin (or look like it) and resolve elsewhere
  test('nor through a path that only starts with /admin', () => {
    for (const callback of ESCAPES) {
      const location = linkErrorRedirect(callback, 'X')
      expect(location).not.toStartWith('//')
      expect(location).toMatch(/^\/admin(?:[/?]|$)/)
      expect(new URL(location, 'https://kibo.example').origin).toBe(
        'https://kibo.example',
      )
    }
  })
})

// Attempts to leave the admin area that a check of the raw string would let
// through, or that lead off the site
const ESCAPES = [
  '/admin/..//evil.example',
  '/admin/%2e%2e//x',
  '/admin/../\\x',
  '//evil.example',
  '/admin//evil.example',
  '/\\evil.example/admin',
  '/administrator',
]

describe('adminRedirectTarget', () => {
  test('keeps a page of the admin area, query and fragment included', () => {
    expect(adminRedirectTarget('/admin')).toBe('/admin')
    expect(adminRedirectTarget('/admin/boards?x=1#a')).toBe(
      '/admin/boards?x=1#a',
    )
    expect(adminRedirectTarget('/admin?x=1')).toBe('/admin?x=1')
  })

  test('falls back to /admin for anything else', () => {
    for (const requested of [
      null,
      '',
      'admin',
      'https://evil.example/admin',
      '/k/abc/',
    ]) {
      expect(adminRedirectTarget(requested)).toBe('/admin')
    }
  })

  test('never leads off the site or out of the admin area', () => {
    for (const requested of ESCAPES) {
      const target = adminRedirectTarget(requested)
      expect(target).not.toStartWith('//')
      expect(target).toMatch(/^\/admin(?:[/?#]|$)/)
      expect(new URL(target, 'https://kibo.example').origin).toBe(
        'https://kibo.example',
      )
    }
  })
})

describe('loginUrl', () => {
  test('leads back to the page that was asked for, query included', () => {
    const page = new URL('https://kibo.example/admin/invitation?id=a b&x=1')
    const login = new URL(loginUrl(page), page)
    expect(login.pathname).toBe('/admin/login')
    expect(login.searchParams.get('redirectTo')).toBe(
      '/admin/invitation?id=a%20b&x=1',
    )
  })
})

// What the middleware asks before it sends somebody without a Kita to the
// form for one
describe('needsOrganization', () => {
  test('the pages of a Kita need one', () => {
    for (const path of [
      '/admin',
      '/admin/boards',
      '/admin/boards/new',
      '/admin/kita',
      '/admin/abo/rechnung',
    ]) {
      expect(needsOrganization(path)).toBe(true)
    }
  })

  test('creating a Kita and the account page do not', () => {
    expect(needsOrganization('/admin/organizations/new')).toBe(false)
    expect(needsOrganization('/admin/account')).toBe(false)
  })

  // An account whose Kitas were deleted has none and still has to get there
  test('nor does the subscription page of the hosted instance', () => {
    expect(needsOrganization('/admin/abo')).toBe(false)
  })
})

describe('isAdminRedirect', () => {
  test('accepts the callbacks Kibo puts into its links', () => {
    for (const callback of [
      VERIFY_EMAIL_CALLBACK,
      EMAIL_CHANGE_CALLBACK,
      EMAIL_CHANGE_DONE_CALLBACK,
    ]) {
      expect(isAdminRedirect(callback)).toBe(true)
    }
  })

  test('refuses anything the browser would read differently', () => {
    for (const requested of [
      ...ESCAPES.filter((escape) => escape !== '/admin//evil.example'),
      '/..//evil.example',
      'https://evil.example/admin',
      '',
      undefined,
      ['/admin'],
    ]) {
      expect(isAdminRedirect(requested)).toBe(false)
    }
  })
})
