import { describe, expect, test } from 'bun:test'

import {
  linkErrorRedirect,
  loginUrl,
  needsOrganization,
} from '@/lib/admin-redirect'

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
