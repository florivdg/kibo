import { hostedContact, hostedPricing } from '@/lib/instance'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import {
  invoiceRequestConfirmationMail,
  invoiceRequestOperatorMail,
} from '@/lib/mail/templates'

import { invoiceFacts, type BillingDetails } from './billing'

// The two mails that follow an invoice request
// (src/actions/subscription.ts): everything the invoice needs to the operator
// (HOSTED_OPERATOR_EMAIL), and a confirmation to the address it will go to.
// The request itself is in the database by then — the mails announce it, the
// operator's script shows it either way (scripts/admin/invoice.ts).

// How the mails go out. An object, so the tests can read them instead.
export const invoiceMails: { send: (mail: Mail) => Promise<unknown> } = {
  send: sendMail,
}

export async function sendInvoiceRequestMails(
  account: { email: string; kitas: string[]; paidUntil: Date | null },
  billing: BillingDetails,
  now: Date,
) {
  const facts = invoiceFacts(account, billing, hostedPricing, now)
  // sendMail logs a delivery that fails and never throws
  await Promise.all([
    invoiceMails.send({
      to: hostedContact.operatorEmail,
      ...invoiceRequestOperatorMail(account.email, facts.operator),
    }),
    invoiceMails.send({
      to: billing.billingEmail,
      ...invoiceRequestConfirmationMail(facts.invoice),
    }),
  ])
}
