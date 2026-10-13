import { longDate } from '@/lib/board/time'
import { invoiceFacts } from '@/lib/hosted/billing'
import { findSubscription, ownedKitas } from '@/lib/hosted/subscriptions'
import { detailText } from '@/lib/mail/details'

import { CommandError, type Command } from './command'
import { accountByEmail, NONE, pricingFrom } from './hosted'

// Everything an invoice needs, for the account that asked for one: who it is
// made out to, what it is for and the year it covers — and the call that
// records the payment. Reads only; `set-paid` is what changes something.
export const invoiceCommand: Command = {
  summary: 'Zeigt die Rechnungsdaten eines Kontos: Empfänger, Betrag, Zeitraum',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
  },
  notes: [
    'Der Betrag gilt für die Kitas, die dem Konto jetzt gehören. Der Zeitraum',
    'schließt an einen laufenden bezahlten Zeitraum an, sonst beginnt er heute.',
  ],
  async run({ values: { email = '' } }, { db, io, env, now }) {
    const pricing = pricingFrom(env)
    const account = await accountByEmail(db, email)
    const subscription = await findSubscription(db, account.id)
    if (!subscription?.billingName) {
      throw new CommandError(
        `Für ${account.email} liegen keine Rechnungsdaten vor`,
      )
    }
    const kitas = await ownedKitas(db, account.id)
    const requested = subscription.invoiceRequestedAt
    // The lines of the mail the operator got with the request, as they would
    // read today
    const { operator } = invoiceFacts(
      {
        email: account.email,
        kitas: kitas.map((kita) => kita.name),
        paidUntil: subscription.paidUntil,
      },
      {
        billingName: subscription.billingName,
        billingAddress: subscription.billingAddress ?? NONE,
        billingEmail: subscription.billingEmail ?? NONE,
        billingReference: subscription.billingReference,
      },
      pricing,
      now,
    )
    const fields = [
      {
        label: 'Anfrage',
        value: requested ? longDate(requested) : 'Keine offene Anfrage',
      },
      ...operator,
    ]
    io.stdout.write(`${fields.map(detailText).join('\n')}\n`)
  },
}
