import { describe, expect, test } from 'bun:test'
import { APIError } from 'better-auth/api'

import {
  assertEmailDomainAllowed,
  assertSignupAllowed,
  type SignupPolicy,
} from '@/lib/signup-rules'

import { apiRefusal } from './helpers/api-error'

const open: SignupPolicy = { open: true, domains: [] }
const closed: SignupPolicy = { open: false, domains: [] }
const verbund = ['kita-verbund.de', '*.kita-verbund.de']

// What the hook answered: status and code, or null when it let the call pass
function rejection(check: () => void) {
  try {
    check()
    return null
  } catch (error) {
    return apiRefusal(error)
  }
}

const SIGNUP_CLOSED = { status: 403, code: 'SIGNUP_CLOSED' }
const NOT_ALLOWED = { status: 403, code: 'EMAIL_DOMAIN_NOT_ALLOWED' }

describe('assertSignupAllowed', () => {
  test('an open instance without a list takes any address', () => {
    expect(
      rejection(() => assertSignupAllowed('anna@gmail.com', open)),
    ).toBeNull()
    // Not an address at all: Better Auth's own INVALID_EMAIL answers that
    expect(rejection(() => assertSignupAllowed(undefined, open))).toBeNull()
  })

  test('a closed instance takes nobody', () => {
    expect(
      rejection(() => assertSignupAllowed('anna@gmail.com', closed)),
    ).toEqual(SIGNUP_CLOSED)
    expect(rejection(() => assertSignupAllowed(undefined, closed))).toEqual(
      SIGNUP_CLOSED,
    )
  })

  // The open invitation the sign-up named by its id lets its own address
  // through, and nobody else
  describe('closed, with an invitation', () => {
    const invitation = { email: 'anna@gmail.com' }

    test('takes the invited address, however it is written', () => {
      for (const email of ['anna@gmail.com', ' Anna@Gmail.com ']) {
        expect(
          rejection(() => assertSignupAllowed(email, closed, invitation)),
        ).toBeNull()
      }
    })

    test('turns every other address away like a sign-up without one', () => {
      for (const email of ['bea@gmail.com', 'anna@gmail.com.evil', undefined]) {
        expect(
          rejection(() => assertSignupAllowed(email, closed, invitation)),
        ).toEqual(SIGNUP_CLOSED)
      }
    })

    test('the domain list holds for the invited as well', () => {
      const policy = { open: false, domains: verbund }
      expect(
        rejection(() =>
          assertSignupAllowed('anna@gmail.com', policy, invitation),
        ),
      ).toEqual(NOT_ALLOWED)
      const listed = { email: 'anna@kita-verbund.de' }
      expect(
        rejection(() =>
          assertSignupAllowed('anna@kita-verbund.de', policy, listed),
        ),
      ).toBeNull()
    })

    // An open instance never asks for one
    test('changes nothing for an open instance', () => {
      expect(
        rejection(() => assertSignupAllowed('bea@gmail.com', open, invitation)),
      ).toBeNull()
    })
  })

  // Closed wins: the answer doesn't say which domains would have been taken
  test('closed comes before the domain list', () => {
    const policy = { open: false, domains: verbund }
    expect(
      rejection(() => assertSignupAllowed('anna@kita-verbund.de', policy)),
    ).toEqual(SIGNUP_CLOSED)
    expect(
      rejection(() => assertSignupAllowed('anna@gmail.com', policy)),
    ).toEqual(SIGNUP_CLOSED)
  })

  describe('open with a domain list', () => {
    const policy = { open: true, domains: verbund }

    test('takes a listed domain, whatever its case', () => {
      for (const email of ['anna@kita-verbund.de', 'Anna@Kita-Verbund.DE']) {
        expect(rejection(() => assertSignupAllowed(email, policy))).toBeNull()
      }
    })

    test('takes a subdomain through the wildcard', () => {
      for (const email of [
        'x@nord.kita-verbund.de',
        'x@a.nord.kita-verbund.de',
      ]) {
        expect(rejection(() => assertSignupAllowed(email, policy))).toBeNull()
      }
    })

    test('turns every other domain away', () => {
      for (const email of [
        'x@gmail.com',
        'x@kita-verbund.de.evil.example',
        'x@notkita-verbund.de',
      ]) {
        expect(rejection(() => assertSignupAllowed(email, policy))).toEqual(
          NOT_ALLOWED,
        )
      }
    })

    test('a wildcard alone leaves the domain itself out', () => {
      const subdomainsOnly = { open: true, domains: ['*.kita-verbund.de'] }
      expect(
        rejection(() =>
          assertSignupAllowed('x@kita-verbund.de', subdomainsOnly),
        ),
      ).toEqual(NOT_ALLOWED)
      expect(
        rejection(() =>
          assertSignupAllowed('x@nord.kita-verbund.de', subdomainsOnly),
        ),
      ).toBeNull()
    })

    test('matches an IDN however the address spells it', () => {
      const idn = { open: true, domains: ['xn--mller-kva.de'] }
      for (const email of ['anna@müller.de', 'anna@XN--MLLER-KVA.de']) {
        expect(rejection(() => assertSignupAllowed(email, idn))).toBeNull()
      }
    })

    // Fail closed: what cannot be compared is not on the list
    test('turns away what is no address', () => {
      for (const email of [undefined, null, 42, '', 'anna', ['x@gmail.com']]) {
        expect(rejection(() => assertSignupAllowed(email, policy))).toEqual(
          NOT_ALLOWED,
        )
      }
    })
  })
})

// The hook on /change-email hands in the new address
describe('assertEmailDomainAllowed', () => {
  test('without a list every new address passes', () => {
    expect(
      rejection(() => assertEmailDomainAllowed('neu@gmail.com', [])),
    ).toBeNull()
    expect(rejection(() => assertEmailDomainAllowed(undefined, []))).toBeNull()
  })

  test('with a list the new address has to be on it', () => {
    expect(
      rejection(() => assertEmailDomainAllowed('neu@kita-verbund.de', verbund)),
    ).toBeNull()
    expect(
      rejection(() =>
        assertEmailDomainAllowed('neu@sued.kita-verbund.de', verbund),
      ),
    ).toBeNull()
    expect(
      rejection(() => assertEmailDomainAllowed('neu@gmail.com', verbund)),
    ).toEqual(NOT_ALLOWED)
    expect(
      rejection(() => assertEmailDomainAllowed(undefined, verbund)),
    ).toEqual(NOT_ALLOWED)
  })

  // The same answer for every address of a foreign domain: it cannot say
  // whether one of them has an account
  test('answers a rejected domain the same way every time', () => {
    const answer = (email: string) => {
      try {
        assertEmailDomainAllowed(email, verbund)
      } catch (error) {
        return JSON.stringify(error instanceof APIError ? error.body : null)
      }
    }
    expect(answer('vorhanden@gmail.com')).toBe(answer('unbekannt@gmail.com'))
    expect(answer('vorhanden@gmail.com')).toContain('EMAIL_DOMAIN_NOT_ALLOWED')
  })
})
