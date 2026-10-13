import { defineRequestState } from '@better-auth/core/context'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from 'astro:env/server'
import { betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'

import { db } from '@/db'
import { assertAccountName } from '@/lib/account-rules'
import { linkErrorRedirect } from '@/lib/admin-redirect'
import { authOptions, authPlugins } from '@/lib/auth-options'
import { invitationPath } from '@/lib/auth-paths'
import { findOrganizationName } from '@/lib/board/queries'
import { errorMessage } from '@/lib/error-message'
import {
  currentTerms,
  hostedKitaCreation,
  isCurrentTermsVersion,
} from '@/lib/hosted/access'
import type { KitaCreationRefusal } from '@/lib/hosted/kita-limit'
import { KITA_CREATION_MESSAGES } from '@/lib/hosted/messages'
import {
  ensureSubscription,
  type TermsAcceptance,
} from '@/lib/hosted/subscriptions'
import { sendTermsConfirmation } from '@/lib/hosted/terms'
import { hostedPricing, instanceMode, signupPolicy } from '@/lib/instance'
import { ORGANIZATION_LIMIT, PASSKEYS_PER_ACCOUNT } from '@/lib/limits'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import {
  emailChangeConfirmationMail,
  invitationMail,
  newEmailVerificationMail,
  passwordResetMail,
  verificationMail,
} from '@/lib/mail/templates'
import {
  countOwnedOrganizations,
  deleteOwnedOrganizations,
  firstOrganizationId,
  memberRole,
  rememberOrganizationsOf,
} from '@/lib/organization-access'
import { findPendingInvitation } from '@/lib/organization-members'
import { ADMIN_ROLE, mayInvite } from '@/lib/organization-roles'
import { countPasskeysOf, deletePasskeysOf } from '@/lib/passkeys/queries'
import { isValidPasskeyName } from '@/lib/passkeys/rules'
import {
  passkeyTransaction,
  withPasskeyTransactions,
} from '@/lib/passkeys/transactions'
import { looksLikeLink } from '@/lib/plain-text'
import {
  assertEmailDomainAllowed,
  assertSignupAllowed,
} from '@/lib/signup-rules'
import type { AuthMailKind } from '@/lib/spam/budgets'
import {
  allowAuthMail,
  allowInvitation,
  allowInvitationMail,
  allowSignIn,
} from '@/lib/spam/guard'
import { trustedProxies } from '@/lib/trusted-proxies'
import {
  EMAIL_CHANGE_DONE_CALLBACK,
  isEmailChangeVerification,
  withCallbackURL,
} from '@/lib/verification-token'

// Better Auth's own limits count per network. This one counts per recipient
// and kind of mail, so a mailbox can't be buried by asking from many networks,
// and per recipient and network, so one network can't use up what the
// recipient has left. Skipping the send looks exactly like a successful one to
// the caller, which keeps the answer generic: it still says nothing about
// whether an account exists.
//
// Nothing here is awaited. Better Auth only calls this when an account exists,
// so waiting for a budget check and an SMTP round trip would make "password
// forgotten" measurably slower for addresses that have an account — the
// identical answer would still tell an attacker which ones those are. The Node
// adapter keeps running after the response, so the send finishes either way.
// Returns an already-resolved promise: Better Auth awaits what it gets back,
// and there must be nothing left to wait for.
async function sendUnlessFlooded(
  kind: AuthMailKind,
  mail: Mail,
  request: Request | undefined,
): Promise<void> {
  void allowAuthMail(mail.to, kind, request)
    .then((allowed) => (allowed ? sendMail(mail) : undefined))
    .catch(logSendFailure)
}

function logSendFailure(error: unknown) {
  console.error(
    `[mail] Versand konnte nicht angestoßen werden: ${errorMessage(error)}`,
  )
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

// The last link of an address change signs in whoever opens it when there is
// no session yet — past the password and TOTP, which is exactly what the
// sign-up link deliberately doesn't do. Turn it away unless the browser is
// already signed in; the account page then asks to open it again.
async function requireSessionForEmailChange(ctx: HookContext) {
  const query: Record<string, unknown> = ctx.query ?? {}
  if (!isEmailChangeVerification(query.token)) return
  if (await getSessionFromCtx(ctx)) return
  throw ctx.redirect(
    linkErrorRedirect(query.callbackURL, 'EMAIL_CHANGE_NEEDS_SESSION'),
  )
}

function badRequest(code: string, message: string) {
  return APIError.fromStatus('BAD_REQUEST', { code, message })
}

// Without a password Better Auth would accept any session younger than a day.
// Deleting an account (and possibly its Kita) asks for it every time. Adding
// a passkey asks for it too (below), where a body without one, or with
// something other than a string, mustn't reach Better Auth's hash function.
function requirePassword(ctx: HookContext) {
  const { password } = (ctx.body ?? {}) as { password?: unknown }
  if (typeof password === 'string' && password !== '') return
  throw badRequest('INVALID_PASSWORD', 'Password is required')
}

// Blank is no name; the account page shows the authenticator's then
function assertPasskeyName(name: unknown) {
  const trimmed = typeof name === 'string' ? name.trim() : name
  if (trimmed === undefined || trimmed === '' || isValidPasskeyName(trimmed)) {
    return
  }
  throw badRequest('INVALID_PASSKEY_NAME', 'Invalid passkey name')
}

// A passkey signs in without password and code, so adding one asks for the
// password, like every other change that touches how the account is signed
// into — a session left open on a shared computer mustn't be enough to plant
// one. Checked here, on the final step, rather than when the options are
// fetched: that is a GET, and the password would end up in a query string.
// The account page asks /verify-password first, so a typo is said before the
// browser asks for a fingerprint (src/lib/passkeys/register-client.ts); this
// is the check that binds.
//
// The name is Kibo's to check too: Better Auth stores any string. And the
// number per account. Without a session this steps aside and leaves the 401
// to the plugin.
async function checkPasskeyRegistration(ctx: HookContext) {
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const userId = session.user.id
  // The name first: it costs nothing, the password a hash
  const { name } = (ctx.body ?? {}) as { name?: unknown }
  assertPasskeyName(name)
  // Then Better Auth's own check, the one its routes that ask for the
  // password use: it reads ctx.body.password, refuses one that is too long,
  // and hashes even for an account without a password, so the answer takes
  // as long
  requirePassword(ctx)
  await ctx.context.password.checkPassword(userId, ctx)
  const on = (await passkeyTransaction.get()) ?? db
  if ((await countPasskeysOf(userId, on)) >= PASSKEYS_PER_ACCOUNT) {
    throw badRequest('PASSKEY_LIMIT_REACHED', 'Passkey limit reached')
  }
}

// A reset is how a stolen account is taken back. Whoever added a passkey
// knew the password, and a passkey that survived the reset would let them
// straight back in; the owner adds theirs again in a few seconds. Better Auth
// calls this after storing the new password and before ending the sessions.
// transactions.ts wraps that whole endpoint in one transaction under the
// user's row lock, also taken by passkey registration and authentication.
// A failure rolls back the password, token consumption and cleanup together.
async function removePasskeysOnReset({ user }: { user: { id: string } }) {
  try {
    await deletePasskeysOf(user.id, (await passkeyTransaction.get()) ?? db)
  } catch (error) {
    console.error(
      `[auth] Passkeys beim Zurücksetzen nicht gelöscht: ${errorMessage(error)}`,
    )
    throw error
  }
}

// 429 like Better Auth's own limit, with the wait in seconds
function tooManyRequests(code: string, retryAfterMs: number) {
  return new APIError(
    'TOO_MANY_REQUESTS',
    { code, message: 'Too many requests. Please try again later.' },
    { 'X-Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
  )
}

// Better Auth limits sign-in attempts per network. This limits them per
// account as well, so a password can't be guessed from many networks at once.
// Every attempt counts, whatever its outcome.
async function limitSignInPerAccount(ctx: HookContext) {
  const { email } = (ctx.body ?? {}) as { email?: unknown }
  if (typeof email !== 'string') return
  const { allowed, retryAfterMs = 0 } = await allowSignIn(email)
  if (!allowed) throw tooManyRequests('TOO_MANY_REQUESTS', retryAfterMs)
}

// The name greets the recipient of every mail, sign-up confirmations for an
// address that isn't necessarily the sender's included
function checkAccountName(ctx: HookContext) {
  const { name } = (ctx.body ?? {}) as { name?: unknown }
  if (ctx.path === '/update-user' && name === undefined) return
  assertAccountName(name)
}

// Whether this instance takes sign-ups at all, and from which mail domains
// (src/lib/instance.ts). A hook rather than a disabled path, because an
// invitation lets its address through a closed sign-up: the sign-up page
// sends the id from the invitation link along, and that id — never the
// address — is what the invitation is looked up by. An open instance doesn't
// look; the domain list holds for the invited as well.
async function checkSignupPolicy(ctx: HookContext) {
  const { email, invitationId } = (ctx.body ?? {}) as {
    email?: unknown
    invitationId?: unknown
  }
  const invitation =
    !signupPolicy.open && typeof invitationId === 'string'
      ? await findPendingInvitation(invitationId)
      : undefined
  assertSignupAllowed(email, signupPolicy, invitation)
}

// The domain list holds for the new address of an existing account too — but
// only someone signed in gets to hear about it. This hook runs before Better
// Auth's session check, so without one it steps aside and leaves the 401 to
// that: an anonymous request gets the same answer for every domain, and the
// list of a closed instance can't be probed here (see src/lib/signup-rules.ts).
async function checkNewEmailDomain(ctx: HookContext) {
  if (!(await getSessionFromCtx(ctx))) return
  const { newEmail } = (ctx.body ?? {}) as { newEmail?: unknown }
  assertEmailDomainAllowed(newEmail, signupPolicy.domains)
}

// A budget that is used up (src/lib/spam/budgets.ts). Said openly, with the
// wait: whoever gets this far is signed in and owns the Kita.
function tooManyInvitations(retryAfterMs = 0) {
  return tooManyRequests('TOO_MANY_INVITATIONS', retryAfterMs)
}

// Who asks to invite, and into which Kita: the one the request names,
// otherwise the active one — picked exactly the way the plugin picks it, so
// the checks below are about the Kita the invitation will be created in.
// (Anything that isn't a string is turned away by the plugin's validation.)
// Undefined for whoever may not invite there: no session, no membership, or
// a role without that right. The role is asked of the table the plugin reads
// (src/lib/organization-roles.ts), so the two can't come to different answers.
async function invitationRequester(ctx: HookContext, requested: unknown) {
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const active: unknown = session.session.activeOrganizationId
  const organizationId = requested || active
  if (typeof organizationId !== 'string') return
  const userId = session.user.id
  const role = await memberRole(organizationId, userId)
  if (role === undefined || !mayInvite(role)) return
  return { organizationId, userId }
}

// The mail goes to an address of the owner's choosing and names the Kita; a
// name that reads like a link would put that link into a mail from Kibo to a
// stranger. Creating and renaming a Kita refuse such names
// (src/lib/organization-rules.ts). This is the backstop for the ones stored
// before that rule existed: such a Kita is renamed before it invites.
async function assertPlainOrganizationName(organizationId: string) {
  const name = await findOrganizationName(organizationId)
  if (name === undefined || !looksLikeLink(name)) return
  throw badRequest(
    'ORGANIZATION_NAME_LOOKS_LIKE_LINK',
    'Organization name looks like a link',
  )
}

// What Kibo asks of an invitation before Better Auth creates it. Here rather
// than in the plugin's beforeCreateInvitation: by then the plugin has already
// withdrawn the invitation the address had before, and a refusal would leave
// it with none. That is also why the recipient's mail budget is asked here
// and not when the mail goes out: an invitation whose mail were dropped would
// have cancelled a link that works and put one nobody receives in its place.
//
// Without a session, and for anyone who may not invite into the Kita, this
// steps aside and leaves the answer (401, 403) to the plugin — so an admin
// hammering the route spends none of the Kita's budget, and nobody without
// the right to invite learns what the domain list says.
async function checkInvitationRequest(ctx: HookContext) {
  // Read before Better Auth has validated it: nothing in it is known to be a
  // string yet
  const body = (ctx.body ?? {}) as {
    email?: unknown
    role?: unknown
    organizationId?: unknown
  }
  const requester = await invitationRequester(ctx, body.organizationId)
  if (!requester) return
  const { organizationId, userId } = requester

  // Invited people become admins, whatever the request asks for
  if (body.role !== ADMIN_ROLE) {
    throw badRequest('INVALID_INVITATION_ROLE', 'Invalid role')
  }
  await assertPlainOrganizationName(organizationId)
  // Said now, to the owner, rather than to the invited person at sign-up
  assertEmailDomainAllowed(body.email, signupPolicy.domains)
  // What the Kita and the owner may still send (src/lib/spam/budgets.ts) …
  const sender = await allowInvitation(organizationId, userId)
  if (!sender.allowed) throw tooManyInvitations(sender.retryAfterMs)
  // … and what the invited address still takes, from this network and in
  // total. Without an address there is nothing to count; the plugin turns
  // the request away.
  if (typeof body.email !== 'string') return
  const recipient = await allowInvitationMail(body.email, ctx.request)
  if (!recipient.allowed) throw tooManyInvitations(recipient.retryAfterMs)
}

// What the request that creates a Kita on the hosted instance found out
// about the account before the plugin ran (checkKitaCreation), for the
// plugin's hooks that follow: they get no request. Kept for the one request
// by Better Auth, so nothing outlives a create that fails, and two creates
// at the same time don't see each other's.
const kitaCreation = defineRequestState<
  | {
      refusal?: KitaCreationRefusal
      terms?: TermsAcceptance
      request?: Request
    }
  | undefined
>(() => undefined)

// On the hosted instance an account agrees to the terms and the data
// processing agreement before it creates its first Kita: the form has a box
// for it, and without `acceptTerms: true` there is no Kita. The form also
// says which version its links showed (`termsVersion`): one that is no longer
// the current — a page left open across a restart with new terms — is turned
// away, so what is stored is what the account saw. Better Auth drops both
// fields from the body it validates, so they are read here. What is stored is
// the version agreed to and the moment — no address of the network.
//
// Without a session this steps aside and leaves the 401 to the plugin. A
// Kita beyond the first asks nothing: the account has agreed, or will when it
// asks for an invoice (src/actions/subscription.ts). Whether the account may
// have the Kita at all is answered by the plugin's limit below, from the same
// look at the account.
async function checkKitaCreation(ctx: HookContext) {
  if (!instanceMode.hosted) return
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const now = new Date()
  const { refusal, termsRequired } = await hostedKitaCreation(
    session.user.id,
    now,
  )
  const { acceptTerms, termsVersion } = (ctx.body ?? {}) as {
    acceptTerms?: unknown
    termsVersion?: unknown
  }
  if (termsRequired && acceptTerms !== true) {
    throw badRequest('TERMS_NOT_ACCEPTED', 'Terms not accepted')
  }
  if (termsRequired && !isCurrentTermsVersion(termsVersion)) {
    throw badRequest('TERMS_VERSION_CHANGED', 'Terms version changed')
  }
  await kitaCreation.set({
    refusal,
    terms: termsRequired ? currentTerms(now) : undefined,
    request: ctx.request,
  })
}

// Whether the account has reached the number of Kitas it may create. Better
// Auth's own number would count every membership, invited ones included; the
// limit is on Kitas an account creates (and pays for). Accepting an
// invitation never asks this.
//
// Self-hosted that is a fixed number, answered with the plugin's own error.
// The hosted instance decides by the account's subscription
// (src/lib/hosted/kita-limit.ts) and has three reasons to say no; the plugin
// knows one code for this, so the refusal is thrown from here with its own.
// A create that didn't come through the check above is asked now.
async function organizationLimitReached(user: { id: string }) {
  if (!instanceMode.hosted) {
    return (await countOwnedOrganizations(user.id)) >= ORGANIZATION_LIMIT
  }
  const { refusal } =
    (await kitaCreation.get()) ??
    (await hostedKitaCreation(user.id, new Date()))
  if (!refusal) return false
  throw APIError.fromStatus('FORBIDDEN', {
    code: refusal,
    message: KITA_CREATION_MESSAGES[refusal],
  })
}

// The hosted instance starts an account's trial with its first Kita, and
// stores what the account agreed to for it. The Kita exists by now and the
// answer says so; should this fail, the Kita has full access until the
// server's hourly run makes up for the subscription
// (startMissingSubscriptions in src/lib/hosted/access.ts) — and the
// agreement is asked for again with the first invoice. An agreement that was
// stored is confirmed to the account by mail, naming the Kita, without
// holding the answer back for the SMTP round trip.
async function startSubscription(
  user: { id: string; name: string; email: string },
  kita: { name: string },
) {
  if (!instanceMode.hosted) return
  const { terms, request } = (await kitaCreation.get()) ?? {}
  try {
    await ensureSubscription(
      db,
      user.id,
      new Date(),
      hostedPricing.trialDays,
      terms,
    )
  } catch (error) {
    console.error(`[hosted] Abo-Eintrag nicht angelegt: ${errorMessage(error)}`)
    return
  }
  if (!terms) return
  void sendTermsConfirmation({
    account: user,
    party: { label: 'Kita', value: kita.name },
    terms,
    request,
  })
}

// Checks that run before Better Auth handles a route, by path and in order.
// The sign-up policy comes first: it turns a request away before anything
// looks at the name or at accounts, so its answer never depends on whether
// an account exists.
const BEFORE_HOOKS: Record<string, ((ctx: HookContext) => unknown)[]> = {
  '/verify-email': [requireSessionForEmailChange],
  '/delete-user': [requirePassword],
  '/sign-in/email': [limitSignInPerAccount],
  '/sign-up/email': [checkSignupPolicy, checkAccountName],
  '/update-user': [checkAccountName],
  '/change-email': [checkNewEmailDomain],
  '/organization/create': [checkKitaCreation],
  '/organization/invite-member': [checkInvitationRequest],
  '/passkey/verify-registration': [checkPasskeyRegistration],
}

// Same trust boundary the note budgets use (src/lib/spam/client-ip.ts).
// Assigned rather than spread so the options keep their literal type, which is
// what carries the plugins' additions to user and session.
authOptions.advanced.ipAddress.trustedProxies = trustedProxies

export const auth = betterAuth({
  ...authOptions,
  advanced: {
    ...authOptions.advanced,
    // Behind the proxy the app speaks plain HTTP, so Better Auth can't tell
    // from the request that the site is served over HTTPS. A production build
    // always marks its cookies Secure (browsers accept that on localhost too).
    useSecureCookies: import.meta.env.PROD,
  },
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    ...authOptions.emailAndPassword,
    // Admins manage a Kita's public board, so the address has to be theirs
    requireEmailVerification: true,
    // A reset is how a stolen account is taken back; end its other sessions
    revokeSessionsOnPasswordReset: true,
    // … and its passkeys, before the sessions go
    onPasswordReset: removePasskeysOnReset,
    sendResetPassword: ({ user, url }, request) =>
      sendUnlessFlooded(
        'reset',
        { to: user.email, ...passwordResetMail(user.name, url) },
        request,
      ),
  },
  user: {
    changeEmail: {
      enabled: true,
      // Two steps: the current address agrees first, then the new one is
      // verified. A stolen session alone can't move the account (and with it
      // the password reset) to an address of the thief's choosing.
      sendChangeEmailConfirmation: ({ user, newEmail, url }, request) =>
        sendUnlessFlooded(
          'email-change',
          {
            to: user.email,
            ...emailChangeConfirmationMail(user.name, newEmail, url),
          },
          request,
        ),
    },
    deleteUser: {
      enabled: true,
      // No confirmation mail: the password is required (hooks below), and
      // the account page warns about what goes with the account — the Kitas
      // it owns, with everyone in them
      beforeDelete: rememberOrganizationsOf,
      // The account is gone by now and the answer says so; a Kita left
      // behind is logged rather than reported as a failed deletion
      afterDelete: async (user) => {
        try {
          await deleteOwnedOrganizations(user)
        } catch (error) {
          console.error(
            `[auth] Kitas des gelöschten Kontos nicht gelöscht: ${errorMessage(error)}`,
          )
        }
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Deliberately no autoSignInAfterVerification: Better Auth would hand out
    // a session straight from the link, past the password and past TOTP. Anyone
    // who can read the mailbox of an account that is 2FA-protected but not yet
    // verified would be signed in as them. Verifying only unlocks the login.
    // Also sends the second step of an address change; `user.email` is the
    // new address then
    sendVerificationEmail: ({ user, url, token }, request) => {
      const emailChange = isEmailChangeVerification(token)
      return sendUnlessFlooded(
        emailChange ? 'email-change' : 'verification',
        {
          to: user.email,
          ...(emailChange
            ? newEmailVerificationMail(
                user.name,
                withCallbackURL(url, EMAIL_CHANGE_DONE_CALLBACK),
              )
            : verificationMail(user.name, url)),
        },
        request,
      )
    },
  },
  // The same plugins as in authOptions, plus what needs the running app: the
  // database for the limit and the subscription, the mailer for invitations,
  // the origin for passkeys
  plugins: authPlugins({
    // The plugin takes the domain passkeys are bound to from baseURL
    // (BETTER_AUTH_URL), but the origin the browser must report from the
    // request's own Origin header unless it is given — so it is given
    passkey: { origin: new URL(BETTER_AUTH_URL).origin },
    wrapPasskey: (plugin) =>
      withPasskeyTransactions(
        plugin,
        createAuthMiddleware(checkPasskeyRegistration),
      ),
    organizationLimit: organizationLimitReached,
    afterCreateOrganization: ({ user, organization }) =>
      startSubscription(user, organization),
    // Every budget — per Kita, per owner and per recipient — was spent
    // before the invitation was created (checkInvitationRequest), so this
    // just sends, without holding the answer back for the SMTP round trip.
    // The link leads to the page that shows the invitation, not to an
    // endpoint that accepts it: opening it signs nobody in.
    sendInvitationEmail: async ({ id, email, organization, inviter }) => {
      void sendMail({
        to: email,
        ...invitationMail({
          organizationName: organization.name,
          inviterName: inviter.user.name,
          url: new URL(invitationPath(id), BETTER_AUTH_URL).href,
        }),
      }).catch(logSendFailure)
    },
  }),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      for (const hook of BEFORE_HOOKS[ctx.path] ?? []) await hook(ctx)
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Start new sessions in the user's first organization, but keep the
        // active one when a session is rotated (e.g. after enabling 2FA)
        before: async (session) => {
          if (session.activeOrganizationId) return
          return {
            data: {
              ...session,
              activeOrganizationId: await firstOrganizationId(
                session.userId,
                (await passkeyTransaction.get()) ?? db,
              ),
            },
          }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
