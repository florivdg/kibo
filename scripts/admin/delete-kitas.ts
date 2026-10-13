import { deleteKitasNow } from '@/lib/hosted/subscriptions'

import { CommandError, type Command } from './command'
import { accountByEmail } from './hosted'

// The end of a switching or erasure request: on the last day of the
// retrieval period, while the deletion is still held (hold-deletion), the
// operator deletes the Kitas the account owns at once and confirms that to
// the customer by mail, with what this prints.
export const deleteKitasCommand: Command = {
  summary: 'Löscht sofort alle Kitas, die einem Konto gehören',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
  },
  notes: [
    'Nicht umkehrbar: Bretter, Zettel, Benachrichtigungs-Abos, Meldungen,',
    'Mitglieder, Einladungen, Kita-Link und Datenschutz-Kontakt gehen mit.',
    'Kitas, in denen das Konto nur Admin ist, bleiben. Konto und Abo-Eintrag',
    'bleiben; Sicherungen enthalten die Daten noch, bis ihre Aufbewahrungsfrist',
    'abläuft.',
  ],
  async run({ values: { email = '' } }, { db, io, now }) {
    const account = await accountByEmail(db, email)
    const deleted = await deleteKitasNow(db, account.id, now)
    if (!deleted.length) {
      throw new CommandError(`${account.email} gehört keine Kita`)
    }
    const lines = deleted.map(({ id, name }) => `[admin]   „${name}“ (${id})\n`)
    io.stdout.write(
      `[admin] ${deleted.length} ${deleted.length === 1 ? 'Kita' : 'Kitas'} von ${account.email} gelöscht:\n` +
        lines.join(''),
    )
  },
}
