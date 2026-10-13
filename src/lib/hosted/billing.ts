import { berlinDay, berlinDayEnd, lastMoment, longDate } from '@/lib/board/time'

import {
  priceBreakdown,
  type HostedPricing,
  type PriceBreakdown,
} from './pricing'

// What an invoice of the hosted instance says: the amount with how it comes
// about (./pricing.ts), the year it covers, and where it goes. Shown on the
// subscription page, written into the mails of an invoice request and printed
// by the operator's script (scripts/admin/invoice.ts) — so nothing here
// imports server code.

// "1 Kita", "3 Kitas"
export function kitaCount(kitas: number) {
  return kitas === 1 ? '1 Kita' : `${kitas} Kitas`
}

// "1 Tag", "30 Tage"
export function dayCount(days: number) {
  return days === 1 ? '1 Tag' : `${days} Tage`
}

// "59 € (49 € inkl. 3 Kitas + 1 × 10 €)"
export function priceLabel(price: PriceBreakdown) {
  const base = `${price.baseEur} € inkl. ${kitaCount(price.includedKitas)}`
  const parts = price.extraKitas
    ? `${base} + ${price.extraKitas} × ${price.extraKitaEur} €`
    : base
  return `${price.totalEur} € (${parts})`
}

// The day a year after the given one, as JJJJ-MM-TT. A 29 February has none;
// its year ends on the 28th.
function sameDayNextYear(day: string) {
  const [year = '', month = '', date = ''] = day.split('-')
  const next = `${Number(year) + 1}-${month}-${date}`
  return berlinDayEnd(next) ? next : `${Number(year) + 1}-${month}-28`
}

export interface SuggestedPeriod {
  // The first moment of the year the invoice covers, and the first that is
  // no longer covered (what `paidUntil` would be)
  from: Date
  until: Date
  // Its last day, the way `set-paid --until` takes it
  setPaidDay: string
}

// The year an invoice asked for at `now` would cover. An account that is
// paid for keeps its rhythm: the new year follows the one that runs, and ends
// on the same day of the calendar. Everyone else's year starts today.
export function suggestedPeriod(
  paidUntil: Date | null | undefined,
  now: Date,
): SuggestedPeriod {
  const renews =
    paidUntil !== null && paidUntil !== undefined && paidUntil > now
  const from = renews ? paidUntil : now
  // The last day that is paid for so far, or today
  const lastDay = berlinDay(renews ? lastMoment(paidUntil) : now)
  const setPaidDay = sameDayNextYear(lastDay)
  // A day of the calendar by construction
  return { from, until: berlinDayEnd(setPaidDay)!, setPaidDay }
}

// "1. Januar 2027 bis 31. Dezember 2027"
export function periodLabel({ from, until }: SuggestedPeriod) {
  return `${longDate(from)} bis ${longDate(lastMoment(until))}`
}

// What a shell reads as one word whatever it is given
const SHELL_SAFE = /^[A-Za-z0-9._+@-]+$/

// One argument of a command line, as a POSIX shell takes it: left as it is
// when nothing in it means anything to a shell, in single quotes otherwise —
// which take everything literally but the quote itself, so that one closes
// the quotes, stands escaped and opens them again ('\'').
function shellWord(value: string) {
  return SHELL_SAFE.test(value)
    ? value
    : `'${value.replaceAll("'", String.raw`'\''`)}'`
}

// The call that records the payment of that year, ready to paste. The
// address is what the account signed up with, and an e-mail address may hold
// an apostrophe and more a shell would act on.
export function setPaidCommand(email: string, { setPaidDay }: SuggestedPeriod) {
  return `node dist/admin.mjs set-paid --email ${shellWord(email)} --until ${setPaidDay}`
}

// Where the invoice goes, as the account typed it on the page
// (src/actions/subscription.ts)
export interface BillingDetails {
  billingName: string
  billingAddress: string
  billingEmail: string
  // A Leitweg-ID or order number to put on the invoice, null for none
  billingReference: string | null
}

// What the form calls the reference, and the line of the mails
export const REFERENCE_LABEL = 'Leitweg-ID / Bestellnummer'

// What an invoice asked for at `now` says, line by line: `invoice` is what
// the address it goes to is told, `operator` the same with whose it is and the
// call that records the payment. The amount is for the Kitas the account
// owns at that moment.
export function invoiceFacts(
  account: { email: string; kitas: string[]; paidUntil?: Date | null },
  billing: BillingDetails,
  pricing: HostedPricing,
  now: Date,
) {
  const period = suggestedPeriod(account.paidUntil, now)
  const price = priceBreakdown(account.kitas.length, pricing)
  const invoice = [
    { label: 'Rechnungsempfänger', value: billing.billingName },
    { label: 'Rechnungsanschrift', value: billing.billingAddress },
    { label: 'Rechnungs-E-Mail', value: billing.billingEmail },
    ...(billing.billingReference
      ? [{ label: REFERENCE_LABEL, value: billing.billingReference }]
      : []),
    { label: 'Jahresbetrag', value: priceLabel(price) },
    { label: 'Zeitraum', value: periodLabel(period) },
  ]
  return {
    invoice,
    operator: [
      { label: 'Konto', value: account.email },
      { label: 'Kitas', value: account.kitas.join('\n') || 'keine' },
      ...invoice,
      {
        label: 'Nach Zahlungseingang',
        value: setPaidCommand(account.email, period),
      },
    ],
  }
}
