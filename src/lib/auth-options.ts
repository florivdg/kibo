import { passkey, type PasskeyOptions } from '@better-auth/passkey'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { organization, twoFactor } from 'better-auth/plugins'
import type { OrganizationOptions } from 'better-auth/plugins/organization'

// Relative on purpose, here and in the modules below: the schema generator
// loads this file outside of Astro and Vite, where the @/ alias may not resolve
import {
  INVITATION_LIMIT,
  INVITATION_TTL_S,
  MEMBERSHIP_LIMIT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './limits'
import { ac, OWNER_ROLE, roles } from './organization-roles'
import {
  beforeCreateOrganization,
  beforeUpdateOrganization,
} from './organization-rules'
import {
  afterAuthentication,
  afterRegistration,
  UNUSED_PASSKEY_PATHS,
} from './passkeys/rules'

const MINUTE = 60
const HOUR = 60 * MINUTE

// Guessing a password or a code: as many tries as the login page allows
const GUESSING = { window: 10 * MINUTE, max: 10 }

// The organization endpoints Kibo uses: creating a Kita, renaming it,
// switching between Kitas and listing them, inviting an admin and answering
// an invitation, removing a member and leaving. Everything else the plugin
// brings (changing roles, deleting a Kita, asking for permissions) has no UI
// and is switched off, so nobody can reach it by calling the API directly.
// Members and invitations are listed by the pages themselves, on the server
// (src/lib/organization-members.ts), so the routes that read them stay off as
// well — get-full-organization among them: it would hand every member of a
// Kita the list of its invitations, ids included, and only the owner gets to
// see who has been invited. Teams and dynamic roles aren't enabled, so their
// routes don't exist in the first place. tests/auth-rules.test.ts checks that
// every organization route is in one of the two lists.
export const ORGANIZATION_PATHS_IN_USE = [
  '/organization/create',
  '/organization/update',
  '/organization/set-active',
  '/organization/list',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/remove-member',
  '/organization/leave',
]

const UNUSED_ORGANIZATION_PATHS = [
  '/organization/check-slug',
  '/organization/delete',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/get-full-organization',
  '/organization/get-invitation',
  '/organization/get-organization',
  '/organization/has-permission',
  '/organization/list-invitations',
  '/organization/list-members',
  '/organization/list-user-invitations',
  '/organization/update-member-role',
]

// What the organization plugin is set up with, as far as it needs no database
const ORGANIZATION_PLUGIN_OPTIONS = {
  // Owner and admin (src/lib/organization-roles.ts)
  ac,
  roles,
  // Better Auth's default, said here because Kibo's own queries ask for it by
  // name (src/lib/organization-access.ts)
  creatorRole: OWNER_ROLE,
  membershipLimit: MEMBERSHIP_LIMIT,
  // Invitations of one Kita still waiting for an answer
  invitationLimit: INVITATION_LIMIT,
  invitationExpiresIn: INVITATION_TTL_S,
  // Inviting an address again withdraws the link it got before and sends a
  // fresh one; there is no separate "send again"
  cancelPendingInvitationsOnReInvite: true,
  // The login asks for a confirmed address anyway; said here as well, so
  // that an invitation can never be answered from an unconfirmed one
  requireEmailVerificationOnInvitation: true,
  organizationHooks: { beforeCreateOrganization, beforeUpdateOrganization },
} satisfies OrganizationOptions

type OrganizationHooks = NonNullable<OrganizationOptions['organizationHooks']>

// A passkey signs in on its own, in place of the password and the TOTP code
// (src/lib/passkeys/rules.ts). Resident keys are what the browser offers in
// the e-mail field of the login page without being asked; user verification
// — fingerprint, face or PIN — is what makes the passkey worth as much as
// password and code together.
const PASSKEY_PLUGIN_OPTIONS = {
  rpName: 'Kibo',
  authenticatorSelection: {
    residentKey: 'required',
    userVerification: 'required',
  },
  registration: { afterVerification: afterRegistration },
  authentication: { afterVerification: afterAuthentication },
} satisfies PasskeyOptions

// The plugin, and afterAuthentication after it, look a passkey up by its
// credential id with findOne. With attestation 'none' an authenticator can
// claim any id it likes, so a second row with the same id would have sign-ins
// pick one of the two at random. One row per id, then; the constraint brings
// the index along, so the plugin's own one is left out. Said here rather than
// in the plugin's `schema` option, which can only rename. Better Auth reads
// `plugin.schema` both at runtime and in the schema generator.
function withUniqueCredentialId(plugin: ReturnType<typeof passkey>) {
  const { fields } = plugin.schema.passkey
  return {
    ...plugin,
    schema: {
      ...plugin.schema,
      passkey: {
        ...plugin.schema.passkey,
        fields: {
          ...fields,
          credentialID: { ...fields.credentialID, unique: true, index: false },
        },
      },
    },
  }
}

// The plugins, in one place for both configurations. A Kita is an
// organization: whoever creates it owns it, the people they invite administer
// it with them. The schema generator gets by with the options above; the
// runtime config adds what needs the running app (src/lib/auth.ts — the limit
// of Kitas per account, the invitation mail, what follows a new Kita, and the
// origin passkey ceremonies must come from).
export function authPlugins({
  afterCreateOrganization,
  passkey: passkeyOverrides,
  wrapPasskey,
  ...organizationOverrides
}: Pick<OrganizationOptions, 'organizationLimit' | 'sendInvitationEmail'> &
  Pick<OrganizationHooks, 'afterCreateOrganization'> & {
    passkey?: Pick<PasskeyOptions, 'origin'>
    wrapPasskey?: (
      plugin: ReturnType<typeof passkey>,
    ) => ReturnType<typeof passkey>
  } = {}) {
  const passkeyPlugin = passkey({
    ...PASSKEY_PLUGIN_OPTIONS,
    ...passkeyOverrides,
  })
  // Typed as a tuple rather than an array of either plugin: that is what
  // carries the plugins' additions to user and session
  return [
    organization({
      ...ORGANIZATION_PLUGIN_OPTIONS,
      ...organizationOverrides,
      // Next to the two checks above, not instead of them
      organizationHooks: {
        ...ORGANIZATION_PLUGIN_OPTIONS.organizationHooks,
        afterCreateOrganization,
      },
    }),
    twoFactor({ issuer: 'Kibo' }),
    withUniqueCredentialId(wrapPasskey?.(passkeyPlugin) ?? passkeyPlugin),
  ] satisfies [] | BetterAuthPlugin[]
}

// Options shared by the runtime config (auth.ts) and the schema generator
// (scripts/auth-schema.ts). Keep anything that affects the schema here —
// rateLimit.storage 'database' is one of those: it creates the rateLimit table.
export const authOptions = {
  appName: 'Kibo',
  // Answered with 404 over HTTP; server-side calls (auth.api) still work
  disabledPaths: [...UNUSED_ORGANIZATION_PATHS, ...UNUSED_PASSKEY_PATHS],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  },
  rateLimit: {
    // On in development too, so the rules that protect production are the ones
    // that get exercised
    enabled: true,
    // The same PostgreSQL every process already talks to: one shared budget
    // instead of one per process, and restarts don't hand out a new one
    storage: 'database',
    window: MINUTE,
    max: 60,
    customRules: {
      // Each of these sends a mail or creates an account. The numbers leave
      // room for a Kita that mistypes its address a few times and still cut a
      // script down to a few attempts an hour per network.
      '/sign-up/email': { window: HOUR, max: 5 },
      '/send-verification-email': { window: HOUR, max: 5 },
      // The client calls requestPasswordReset; Better Auth 1.7.5 has no
      // /forget-password route, so a rule under that name would never apply
      '/request-password-reset': { window: HOUR, max: 5 },
      // Following a link from the mailbox; a legitimate admin needs one or two
      '/reset-password': { window: HOUR, max: 10 },
      '/verify-email': { window: HOUR, max: 20 },
      // Guessing a password, a six-digit TOTP code or a backup code. The
      // login also has a budget per account (src/lib/auth.ts), so many
      // networks together can't guess one password any faster either.
      '/sign-in/email': GUESSING,
      '/two-factor/verify-totp': GUESSING,
      '/two-factor/verify-backup-code': GUESSING,
      // Signed in, but these check the current password; a stolen session
      // shouldn't get to guess it any faster than the login page allows
      '/change-password': GUESSING,
      '/delete-user': GUESSING,
      '/verify-password': GUESSING,
      '/two-factor/enable': GUESSING,
      '/two-factor/disable': GUESSING,
      '/two-factor/get-totp-uri': GUESSING,
      '/two-factor/generate-backup-codes': GUESSING,
      // Adding a passkey asks for the password (checkPasskeyRegistration in
      // src/lib/auth.ts); signing in with one creates a session. A real
      // passkey needs neither twice in a row.
      '/passkey/verify-registration': GUESSING,
      '/passkey/verify-authentication': GUESSING,
      // Each stores a challenge (a verification row) for five minutes. One
      // view of the login page asks once for the suggestion in the e-mail
      // field, the button once more, the suggestion again after it, and an
      // open login page once every four minutes, so its suggestion's
      // challenge doesn't expire (src/composables/use-passkey-sign-in.ts)
      '/passkey/generate-register-options': { window: MINUTE, max: 20 },
      '/passkey/generate-authenticate-options': { window: MINUTE, max: 20 },
      // Sends a mail to the current address, like the ones above
      '/change-email': { window: HOUR, max: 5 },
      // Sends a mail to an address the owner of a Kita names. The budgets per
      // Kita, per owner and per recipient are Kibo's own (src/lib/auth.ts)
      '/organization/invite-member': { window: HOUR, max: 10 },
      // Following the link of an invitation, like /verify-email
      '/organization/accept-invitation': { window: HOUR, max: 20 },
      '/organization/reject-invitation': { window: HOUR, max: 20 },
    },
  },
  advanced: {
    ipAddress: {
      // The proxy in front of Kibo drops whatever X-Forwarded-For a client
      // sent and writes a single value of its own. Better Auth trusts a
      // single-value header only, so a forged chain resolves to no IP at all
      // rather than to an attacker-chosen one. Where something appends to the
      // chain, TRUSTED_PROXIES fills trustedProxies here as well (auth.ts).
      ipAddressHeaders: ['x-forwarded-for'],
      // Filled from TRUSTED_PROXIES at runtime (src/lib/auth.ts); the schema
      // generator has no astro:env, so it stays empty there
      trustedProxies: [] as string[],
      // Same collapsing as the note budgets use (src/lib/spam/client-ip.ts)
      ipv6Subnet: 64,
    },
  },
  plugins: authPlugins(),
} satisfies BetterAuthOptions
