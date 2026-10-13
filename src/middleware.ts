import type { APIContext, MiddlewareNext } from 'astro'
import { defineMiddleware } from 'astro:middleware'

// Side effect only: the middleware is the one module every request goes
// through, which makes it the server's start-up hook (signal handlers, the
// clean-up timer, the SMTP check)
import '@/lib/server/runtime'

import { loginUrl, needsOrganization } from '@/lib/admin-redirect'
import { countPageview } from '@/lib/analytics/pageview'
import { auth, type Session } from '@/lib/auth'
import {
  INVITATION_PATH,
  invitationPath,
  RESET_PASSWORD_PATH,
  VERIFY_EMAIL_PATH,
} from '@/lib/auth-paths'
import { withKitaSlash } from '@/lib/board/paths'
import { kitaOwnerSubscription } from '@/lib/hosted/access'
import { subscriptionNotice } from '@/lib/hosted/notice'
import { firstOrganizationId, isMember } from '@/lib/organization-access'
import { pendingInvitationFor } from '@/lib/organization-members'
import { isAdminPath, withSecurityHeaders } from '@/lib/server/security-headers'

// Admin pages reachable without a session; signed-in users are sent on to /admin
const GUEST_PATHS = new Set([
  '/admin/login',
  '/admin/signup',
  '/admin/two-factor',
  '/admin/forgot-password',
  VERIFY_EMAIL_PATH,
])

// Admin pages that render with or without a session. A reset link often gets
// opened in a browser that is still signed in — as the guest page it looks
// like, it would bounce to /admin and drop the token. The link of an
// invitation is opened by people with and without an account; the page sends
// the ones without a session to the login or the sign-up itself.
const PUBLIC_PATHS = new Set([RESET_PASSWORD_PATH, INVITATION_PATH])

// The actions of the admin area: the boards of a Kita, its settings, its
// reported notes, and the subscription of the hosted instance
const ADMIN_ACTIONS = [
  '/_actions/boards.',
  '/_actions/kita.',
  '/_actions/reports.',
  '/_actions/subscription.',
]

// Admin pages, plus admin actions: those get the same verified session but
// reject on their own instead of redirecting
function needsSession(pathname: string) {
  return (
    isAdminPath(pathname) ||
    ADMIN_ACTIONS.some((prefix) => pathname.startsWith(prefix))
  )
}

// Signed-in users need an organization for everything except creating one
// and the few pages about the account itself (src/lib/admin-redirect.ts).
// Someone without a Kita who has been invited to one is taken to the
// invitation rather than to the form for a Kita of their own — this is what
// carries an invited person from the sign-up through the confirmation and the
// login to the invitation, without the link's id travelling along.
async function organizationRedirect(
  pathname: string,
  { session, user }: Session,
) {
  if (session.activeOrganizationId || !needsOrganization(pathname)) {
    return null
  }
  const invitationId = await pendingInvitationFor(user.email)
  return invitationId
    ? invitationPath(invitationId)
    : '/admin/organizations/new'
}

// Guest pages have nothing to say to someone who is already signed in
async function signedInRedirect(pathname: string, result: Session) {
  if (PUBLIC_PATHS.has(pathname)) return null
  return GUEST_PATHS.has(pathname)
    ? '/admin'
    : organizationRedirect(pathname, result)
}

// Everything else needs a session first
function signedOutRedirect(url: URL, pathname: string) {
  const open = GUEST_PATHS.has(pathname) || PUBLIC_PATHS.has(pathname)
  return open ? null : loginUrl(url)
}

// Where a request to an admin page must go instead, or null to render it
async function adminRedirect(url: URL, result: Session | null) {
  const pathname = url.pathname.replace(/(.)\/$/, '$1')
  return result
    ? signedInRedirect(pathname, result)
    : signedOutRedirect(url, pathname)
}

// Only pages redirect; admin actions answer with an error themselves
async function requestRedirect(url: URL, result: Session | null) {
  return isAdminPath(url.pathname) ? adminRedirect(url, result) : null
}

// Removing a member doesn't touch their session, which still names the Kita
// as active — as it does after the owner deleted the Kita with their account.
// Leaving a Kita does the opposite and leaves the session without an active
// one, whatever other Kitas the user has. Either way: fall back to another
// Kita of theirs (or none) before any page reads Kita data.
async function currentOrganizationId({ session, user }: Session) {
  const active = session.activeOrganizationId
  if (active && (await isMember(active, user.id))) return active
  return firstOrganizationId(user.id)
}

// Writes that choice to the session when it differs from what it says
async function withCurrentMembership(result: Session, headers: Headers) {
  const { session } = result
  const organizationId = await currentOrganizationId(result)
  // Still a member, or no Kita before and none now: nothing to switch
  if (organizationId === (session.activeOrganizationId ?? null)) return result
  await auth.api.setActiveOrganization({ headers, body: { organizationId } })
  return {
    ...result,
    session: { ...session, activeOrganizationId: organizationId },
  }
}

// getSession may refresh the session and emit a new cookie; pass it on
function withSessionCookies(response: Response, headers: Headers) {
  for (const cookie of headers.getSetCookie()) {
    response.headers.append('set-cookie', cookie)
  }
  return response
}

// The signed-in session with a verified active Kita, plus headers to forward
async function loadSession(request: Request) {
  const { headers, response } = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  })
  const result =
    response && (await withCurrentMembership(response, request.headers))
  return { headers, result }
}

function storeSession(locals: App.Locals, result: Session | null) {
  locals.user = result?.user
  locals.session = result?.session
  locals.organizationId = result?.session.activeOrganizationId ?? undefined
}

// Where the subscription of the active Kita stands on the hosted instance,
// looked up once for the whole page: the layout shows the notice, the board
// pages switch off what a paused Kita can't do, the subscription page says
// whose it is. Pages only — of the actions, just the ones that change a board
// ask, and they ask themselves (src/actions/kita-access.ts). Without HOSTED
// nothing is looked up.
async function storeSubscription(locals: App.Locals) {
  const { user, organizationId } = locals
  if (!user || !organizationId) return
  const kitaOwner = await kitaOwnerSubscription(organizationId)
  const notice = subscriptionNotice(kitaOwner, user.id)
  locals.kitaOwner = kitaOwner
  locals.subscriptionNotice = notice
  locals.kitaPaused = notice?.state === 'paused'
}

async function handle(context: APIContext, next: MiddlewareNext) {
  if (!needsSession(context.url.pathname)) return next()

  const { headers, result } = await loadSession(context.request)
  const redirect = await requestRedirect(context.url, result)
  if (redirect) return withSessionCookies(context.redirect(redirect), headers)

  storeSession(context.locals, result)
  if (isAdminPath(context.url.pathname)) await storeSubscription(context.locals)
  return withSessionCookies(await next(), headers)
}

// The pages under a Kita link lie within its manifest's scope only with the
// trailing slash (src/lib/board/paths.ts): an address without one is sent on
// to the one with it
function kitaSlashRedirect(context: APIContext) {
  const target = withKitaSlash(context.url)
  return target ? context.redirect(target, 308) : null
}

// A view of the hosted start page is reported once its answer is in hand,
// without waiting for it: the page goes out whatever Plausible does
export const onRequest = defineMiddleware(async (context, next) => {
  const response = kitaSlashRedirect(context) ?? (await handle(context, next))
  void countPageview(context, response)
  return withSecurityHeaders(context.url.pathname, response)
})
