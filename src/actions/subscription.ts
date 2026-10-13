import { ActionError, defineAction } from 'astro:actions'
import { z } from 'astro/zod'

import { optionalText, requiredText } from '@/actions/text-fields'
import { db } from '@/db'
import {
  billingAccount,
  currentTerms,
  isCurrentTermsVersion,
  termsOutstanding,
} from '@/lib/hosted/access'
import type { BillingDetails } from '@/lib/hosted/billing'
import { sendInvoiceRequestMails } from '@/lib/hosted/invoice'
import {
  BILLING_LOOKS_LIKE_LINK,
  SUBSCRIPTION_IS_FREE,
  TERMS_NOT_ACCEPTED,
  TERMS_VERSION_CHANGED,
} from '@/lib/hosted/messages'
import {
  saveInvoiceRequest,
  type Subscription,
  type TermsAcceptance,
} from '@/lib/hosted/subscriptions'
import { sendTermsConfirmation } from '@/lib/hosted/terms'
import { hostedPricing, instanceMode } from '@/lib/instance'
import {
  BILLING_ADDRESS_MAX,
  BILLING_NAME_MAX,
  BILLING_REFERENCE_MAX,
  EMAIL_MAX_LENGTH,
} from '@/lib/limits'
import { looksLikeLink } from '@/lib/plain-text'
import {
  allowInvoiceMail,
  allowInvoiceRequest,
  type LimitVerdict,
} from '@/lib/spam/guard'

// The subscription of the hosted instance, as far as an account acts on it:
// asking for an invoice. Without HOSTED the action answers like one that
// doesn't exist. The middleware verifies the session for subscription.*.

// Why a request was turned away, as the message of the error: the sentence
// the form shows (src/lib/hosted/messages.ts)
function refused(message: string) {
  return new ActionError({ code: 'BAD_REQUEST', message })
}

// A budget that is used up (src/lib/spam/budgets.ts). Said openly, with the
// wait: whoever gets this far is signed in and answers for the account. The
// message is the guard's and travels to the browser, like the one of a note.
function assertAllowed({ allowed, message }: LimitVerdict) {
  if (!allowed) throw new ActionError({ code: 'TOO_MANY_REQUESTS', message })
}

// Who asks, as the account an invoice can go to: signed in, on the hosted
// instance, and the owner — the account that has the subscription or the
// Kitas, not an admin somebody invited. An account that is free for good has
// nothing to ask for.
async function billedAccount({ user }: App.Locals) {
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED' })
  if (!instanceMode.hosted) throw new ActionError({ code: 'NOT_FOUND' })
  const account = await billingAccount(user.id)
  if (!account) throw new ActionError({ code: 'FORBIDDEN' })
  if (account.subscription?.complimentary) throw refused(SUBSCRIPTION_IS_FREE)
  return { user, ...account }
}

// Recipient, address and reference end up in a mail to the operator and in
// one to an address the account typed: no link travels along
function assertNoLinks(billing: BillingDetails) {
  const { billingName, billingAddress, billingReference } = billing
  if (
    [billingName, billingAddress, billingReference ?? ''].some(looksLikeLink)
  ) {
    throw refused(BILLING_LOOKS_LIKE_LINK)
  }
}

// The account agrees to the terms with its first Kita (src/lib/auth.ts). One
// whose row came about without that — a Kita older than HOSTED — or whose
// terms have changed since agrees here, with the request: nothing else asks
// for it, and nothing is blocked until then. The agreement holds only for the
// version the form showed: one that has changed since is turned away, so
// what is stored is what the account saw. Undefined when the current terms
// are agreed to already.
function termsAcceptance(
  subscription: Subscription | undefined,
  {
    acceptTerms,
    termsVersion,
  }: { acceptTerms: boolean; termsVersion?: string },
  now: Date,
): TermsAcceptance | undefined {
  if (!termsOutstanding(subscription)) return undefined
  // The version first: a page rendered before the terms changed may have
  // shown no box at all, and then only a reload helps
  if (!isCurrentTermsVersion(termsVersion)) {
    throw refused(TERMS_VERSION_CHANGED)
  }
  if (!acceptTerms) throw refused(TERMS_NOT_ACCEPTED)
  return currentTerms(now)
}

export const subscription = {
  // Stores where the invoice goes and that it was asked for, tells the
  // operator and confirms it to the address of the invoice — and, when the
  // request carried the agreement to the current terms, that agreement to
  // the account's own address. Asking again while a request is open is how
  // an address is corrected.
  requestInvoice: defineAction({
    input: z.object({
      billingName: requiredText(BILLING_NAME_MAX),
      billingAddress: requiredText(BILLING_ADDRESS_MAX, { multiline: true }),
      billingEmail: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
      // A Leitweg-ID or order number the Kita's administration needs on the
      // invoice; left empty, there is none
      billingReference: optionalText(BILLING_REFERENCE_MAX)
        .default('')
        .transform((value) => value || null),
      acceptTerms: z.boolean().default(false),
      termsVersion: z.string().max(64).optional(),
    }),
    handler: async (
      { acceptTerms, termsVersion, ...billing },
      { locals, request },
    ) => {
      const account = await billedAccount(locals)
      assertNoLinks(billing)
      const now = new Date()
      const terms = termsAcceptance(
        account.subscription,
        { acceptTerms, termsVersion },
        now,
      )
      // What the account may still ask for, then what the address takes
      assertAllowed(await allowInvoiceRequest(account.user.id, now))
      assertAllowed(await allowInvoiceMail(billing.billingEmail, request, now))

      await saveInvoiceRequest(
        db,
        account.user.id,
        { billing, terms, trialDays: hostedPricing.trialDays },
        now,
      )
      await Promise.all([
        sendInvoiceRequestMails(
          {
            email: account.user.email,
            kitas: account.kitas.map((kita) => kita.name),
            paidUntil: account.subscription?.paidUntil ?? null,
          },
          billing,
          now,
        ),
        terms &&
          sendTermsConfirmation({
            account: account.user,
            party: {
              label: 'Rechnung an',
              value: `${billing.billingName}\n${billing.billingAddress}`,
            },
            terms,
            request,
          }),
      ])
    },
  }),
}
