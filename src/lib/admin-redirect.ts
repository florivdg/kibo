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

// Only allow redirects within the admin area (no open redirects)
export function adminRedirectTarget(requested: string | null): string {
  return requested && /^\/admin(?:[/?#]|$)/.test(requested)
    ? requested
    : '/admin'
}

// The login, which leads back to the page that was asked for
export function loginUrl(url: URL): string {
  return `/admin/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`
}

// Where a rejected mail link sends the browser: its callback page inside the
// admin area (never anywhere else), with the reason as ?error= like Better
// Auth's own rejections, so the page shows it the same way
export function linkErrorRedirect(callbackURL: unknown, code: string): string {
  const target = new URL(
    adminRedirectTarget(typeof callbackURL === 'string' ? callbackURL : null),
    'http://localhost',
  )
  target.searchParams.set('error', code)
  return target.pathname + target.search
}
