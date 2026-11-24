import { SUBSCRIPTION_PATH } from '@/lib/auth-paths'

// Admin pages that don't need an active Kita: creating one, the account
// itself, which someone without a Kita must still be able to delete, and the
// subscription of the hosted instance, which outlives the Kitas it paid for
const NO_ORGANIZATION_PATHS = new Set([
  '/admin/organizations/new',
  '/admin/account',
  SUBSCRIPTION_PATH,
])

export function needsOrganization(pathname: string): boolean {
  return !NO_ORGANIZATION_PATHS.has(pathname)
}

// Only allow redirects within the admin area (no open redirects). Checked
// after the URL parser has normalised the path, since that is what the
// browser follows: '/admin/..//evil.example' starts with /admin but resolves
// to the protocol-relative '//evil.example'.
const REDIRECT_BASE = 'http://localhost'
const ADMIN_PATH = /^\/admin(?:\/|$)/

function adminRedirectUrl(requested: string | null): URL {
  if (requested?.startsWith('/')) {
    try {
      const url = new URL(requested, REDIRECT_BASE)
      if (url.origin === REDIRECT_BASE && ADMIN_PATH.test(url.pathname)) {
        return url
      }
    } catch {
      // Not a URL at all: the default below
    }
  }
  return new URL('/admin', REDIRECT_BASE)
}

export function adminRedirectTarget(requested: string | null): string {
  const url = adminRedirectUrl(requested)
  return url.pathname + url.search + url.hash
}

// Whether a redirect target is already an admin path as the browser will
// read it, unchanged by the normalisation above
export function isAdminRedirect(requested: unknown): boolean {
  return (
    typeof requested === 'string' &&
    adminRedirectTarget(requested) === requested
  )
}

// The login, which leads back to the page that was asked for
export function loginUrl(url: URL): string {
  return `/admin/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`
}

// Where a rejected mail link sends the browser: its callback page inside the
// admin area (never anywhere else), with the reason as ?error= like Better
// Auth's own rejections, so the page shows it the same way
export function linkErrorRedirect(callbackURL: unknown, code: string): string {
  const target = adminRedirectUrl(
    typeof callbackURL === 'string' ? callbackURL : null,
  )
  target.searchParams.set('error', code)
  return target.pathname + target.search
}
