import { APIError } from 'better-auth/api'

import { normalizeEmail } from '@/lib/email'

import { isEmailDomainAllowed } from '../../scripts/instance-config.mjs'

// Who may get an account: the two settings of src/lib/instance.ts as plain
// values, so the rules can be tried without an environment
export interface SignupPolicy {
  // SIGNUP_MODE=open
  open: boolean
  // SIGNUP_EMAIL_DOMAINS, parsed; empty allows any domain
  domains: string[]
}

// The domain list, for a new account and for the new address of an existing
// one. It looks at the request and the configuration only, so the answer is
// the same whether or not the address already has an account. Anything that
// isn't an address of an allowed domain is turned away, a missing or
// unparsable one included — without a list those are left to Better Auth,
// which answers INVALID_EMAIL.
export function assertEmailDomainAllowed(email: unknown, domains: string[]) {
  if (domains.length === 0) return
  if (typeof email === 'string' && isEmailDomainAllowed(email, domains)) return
  throw APIError.fromStatus('FORBIDDEN', {
    code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    message: 'Email domain is not allowed',
  })
}

// Signing up. Closed wins over the domain list: a closed instance doesn't
// say which domains it would take.
//
// A closed instance still takes whoever was invited to a Kita. `invitation`
// is the open invitation the request named by its id — looked up by the
// caller, never by address — and it lets exactly its own address through. No
// invitation, one that is over and one for somebody else all get the same
// answer, so the sign-up can't be used to find out who has been invited. The
// domain list holds for the invited as well.
export function assertSignupAllowed(
  email: unknown,
  policy: SignupPolicy,
  invitation?: { email: string },
) {
  const invited =
    invitation !== undefined &&
    typeof email === 'string' &&
    normalizeEmail(email) === normalizeEmail(invitation.email)
  if (!policy.open && !invited) {
    throw APIError.fromStatus('FORBIDDEN', {
      code: 'SIGNUP_CLOSED',
      message: 'Sign-up is closed',
    })
  }
  assertEmailDomainAllowed(email, policy.domains)
}
