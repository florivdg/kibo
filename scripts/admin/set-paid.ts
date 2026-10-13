import { lastMoment, longDate } from '@/lib/board/time'
import { setPaidUntil } from '@/lib/hosted/subscriptions'

import type { Command } from './command'
import { accountByEmail, describeSubscription, untilDay } from './hosted'

// The invoice is paid. There is no payment provider: the operator sends the
// invoice, sees the money arrive and says so here.
export const setPaidCommand: Command = {
  summary: 'Trägt ein, bis wann ein Konto bezahlt hat',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
    until: {
      value: 'JJJJ-MM-TT',
      help: 'Letzter bezahlter Tag (einschließlich, deutsche Zeit)',
    },
  },
  notes: [
    'Legt den Abo-Eintrag bei Bedarf an und setzt eine offene Rechnungsanfrage,',
    'die Erinnerungen und den Vermerk über gelöschte Kitas zurück. Ein Datum in',
    'der Vergangenheit ist erlaubt: Das Abo gilt dann als an diesem Tag',
    'abgelaufen.',
  ],
  async run({ values: { email = '', until = '' } }, { db, io, now }) {
    // Before the database is asked, so a mistyped date changes nothing
    const paid = untilDay(until)
    const account = await accountByEmail(db, email)
    const subscription = await setPaidUntil(db, account.id, paid, now)
    const { label } = describeSubscription(subscription, now)
    io.stdout.write(
      `[admin] ${account.email} ist bezahlt bis einschließlich ` +
        `${longDate(lastMoment(paid))} (Zustand: ${label}).\n`,
    )
  },
}
