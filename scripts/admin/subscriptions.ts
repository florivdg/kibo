import { longDate } from '@/lib/board/time'
import { yearlyPriceEur } from '@/lib/hosted/pricing'
import { deletionHeldThrough } from '@/lib/hosted/state'
import { listSubscriptionAccounts } from '@/lib/hosted/subscriptions'

import type { Command } from './command'
import {
  describeSubscription,
  JSON_FLAG,
  NONE,
  pricingFrom,
  writeList,
} from './hosted'

// What the JSON says about an account that has no subscription yet
const NO_SUBSCRIPTION = {
  complimentary: false,
  trialEndsAt: null,
  paidUntil: null,
  invoiceRequestedAt: null,
  billingName: null,
  billingAddress: null,
  billingEmail: null,
  billingReference: null,
  termsVersion: null,
  termsAcceptedAt: null,
  reminderStage: 0,
  deletionNoticeAt: null,
  kitasDeletedAt: null,
  deletionHeldUntil: null,
}

// Every account the hosted instance bills or could bill, with what it owes
// for a year at the number of Kitas it owns today, and whether it is waiting
// for an invoice
export const subscriptionsCommand: Command = {
  summary:
    'Listet die Konten mit Abo: Zustand, Fristen, Kitas, Jahresbetrag, Rechnungsanfragen',
  options: JSON_FLAG,
  notes: [
    'Aufgeführt sind Konten, denen eine Kita gehört oder die einen Abo-Eintrag',
    'haben. Die Daten nennen jeweils den letzten Tag, der noch gilt; „Anfrage“',
    'ist der Tag einer offenen Rechnungsanfrage (Einzelheiten: invoice).',
    'Mit --json kommen die Rechnungsdaten und der Stand der Erinnerungen mit.',
    '„Löschung angehalten bis …“ steht bei Konten mit offenem Wechsel- oder',
    'Löschverlangen (hold-deletion).',
  ],
  async run({ flags }, { db, io, env, now }) {
    const pricing = pricingFrom(env)
    const accounts = (await listSubscriptionAccounts(db)).map(
      ({ email, ownedKitas, subscription }) => ({
        email,
        ownedKitas,
        subscription,
        ...describeSubscription(subscription, now),
        yearlyPriceEur: yearlyPriceEur(
          ownedKitas,
          pricing,
          subscription?.complimentary,
        ),
      }),
    )
    writeList(io, flags.json, {
      rows: accounts,
      json: (account) => {
        const row = account.subscription ?? NO_SUBSCRIPTION
        return {
          email: account.email,
          state: account.state,
          complimentary: row.complimentary,
          trialEndsAt: row.trialEndsAt,
          paidUntil: row.paidUntil,
          ownedKitas: account.ownedKitas,
          yearlyPriceEur: account.yearlyPriceEur,
          // The invoice the account asked for, and where it goes
          invoiceRequestedAt: row.invoiceRequestedAt,
          billingName: row.billingName,
          billingAddress: row.billingAddress,
          billingEmail: row.billingEmail,
          billingReference: row.billingReference,
          // The terms it agreed to
          termsVersion: row.termsVersion,
          termsAcceptedAt: row.termsAcceptedAt,
          // How far the reminders got, and what came of them
          reminderStage: row.reminderStage,
          deletionNoticeAt: row.deletionNoticeAt,
          kitasDeletedAt: row.kitasDeletedAt,
          // A pending request to switch or to erase: the last day the
          // deletion is held, the way set-paid takes it (hold-deletion);
          // null once the hold is over
          deletionHeldUntil: deletionHeldThrough(row, now),
        }
      },
      empty: 'Keine Konten mit Kita oder Abo-Eintrag.',
      headings: [
        'E-Mail',
        'Zustand',
        'Testende',
        'Bezahlt bis',
        'Kitas',
        '€/Jahr',
        'Anfrage',
      ],
      cells: (account) => [
        account.email,
        account.label,
        account.trialEnds,
        account.paidUntil,
        account.ownedKitas,
        account.yearlyPriceEur,
        account.subscription?.invoiceRequestedAt
          ? longDate(account.subscription.invoiceRequestedAt)
          : NONE,
      ],
    })
  },
}
