import { longDate } from '@/lib/board/time'
import { hostedPricing } from '@/lib/instance'

import {
  billingAccount,
  termsOutstanding,
  type KitaOwnerSubscription,
} from './access'
import { periodLabel, suggestedPeriod } from './billing'
import { statusSummary } from './overview'
import { priceBreakdown } from './pricing'
import type { Subscription } from './subscriptions'

// What the subscription page of the hosted instance shows
// (src/pages/admin/abo.astro). The subscription belongs to an account, so
// the page is the account's: whoever has a subscription or owns Kitas sees
// their own, with what it costs and the form that asks for an invoice. An
// admin somebody invited sees where the subscription of the Kita's owner
// stands and that the owner takes care of it — and nothing about the invoice.

type BillingAccount = NonNullable<Awaited<ReturnType<typeof billingAccount>>>

// What the form starts with: where the last invoice went
function billingDetails(subscription: Subscription | undefined) {
  return {
    billingName: subscription?.billingName ?? '',
    billingAddress: subscription?.billingAddress ?? '',
    billingEmail: subscription?.billingEmail ?? '',
    billingReference: subscription?.billingReference ?? '',
  }
}

// The day an invoice was asked for and where it goes, while the request is
// waiting for the operator
function openInvoiceRequest(subscription: Subscription | undefined) {
  const requestedAt = subscription?.invoiceRequestedAt
  if (!requestedAt) return undefined
  return { on: longDate(requestedAt), email: subscription.billingEmail ?? '' }
}

function ownerView({ subscription, kitas }: BillingAccount, now: Date) {
  return {
    role: 'owner' as const,
    summary: statusSummary(subscription, now),
    kitas: kitas.map((kita) => kita.name),
    price: priceBreakdown(kitas.length, hostedPricing),
    // The year an invoice asked for now would cover
    period: periodLabel(suggestedPeriod(subscription?.paidUntil, now)),
    // An account that is free for good has nothing to ask for
    billed: subscription?.complimentary !== true,
    invoiceRequest: openInvoiceRequest(subscription),
    billing: billingDetails(subscription),
    termsRequired: termsOutstanding(subscription),
  }
}

// `kitaOwner`: who answers for the active Kita, as the middleware left it in
// `locals` (kitaOwnerSubscription in ./access.ts)
export async function subscriptionPageView(
  userId: string,
  kitaOwner: KitaOwnerSubscription | undefined,
  now: Date,
) {
  const account = await billingAccount(userId)
  if (account) return ownerView(account, now)
  // Invited: the state of the subscription the active Kita runs on
  if (!kitaOwner) return { role: 'none' as const }
  return {
    role: 'admin' as const,
    summary: statusSummary(kitaOwner.subscription ?? undefined, now),
  }
}
