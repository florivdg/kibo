import type { Database } from '@/db/types'
import { berlinDay, lastMoment, longDate } from '@/lib/board/time'
import { holdDeletion, releaseDeletionHold } from '@/lib/hosted/subscriptions'

import { CommandError, UsageError, type Command, type Io } from './command'
import { accountByEmail, describeSubscription, untilDay } from './hosted'

// A customer asked to switch providers or to have the data erased (the AGB's
// section on data export and switching): until the retrieval period is over,
// the hourly run neither announces the deletion of the account's Kitas nor
// deletes them. On its last day, while the hold still stands, the operator
// deletes them with delete-kitas.
export const holdDeletionCommand: Command = {
  summary: 'Hält die automatische Löschung der Kitas eines Kontos an',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
    until: {
      value: 'JJJJ-MM-TT',
      optional: true,
      help: 'Letzter Tag der Abruffrist (einschließlich, deutsche Zeit)',
    },
    revoke: { help: 'Anhalten aufheben' },
  },
  notes: [
    'Bis zu diesem Tag geht keine Ankündigung der Löschung hinaus und es wird',
    'nichts automatisch gelöscht. Eine schon verschickte Ankündigung gilt als',
    'zurückgenommen; nach dem Anhalten folgt eine neue, gelöscht wird frühestens',
    'zwei Wochen danach. Pausierte Kitas bleiben pausiert, der Datenexport',
    'funktioniert weiter. Am letzten Tag der Abruffrist, solange noch',
    'angehalten ist, löschen Sie mit delete-kitas.',
    'Der Tag muss nach heute liegen. Mit --revoke (ohne --until) gilt wieder',
    'der gewöhnliche Ablauf. Sind die Kitas schon gelöscht, ändert sich nichts.',
  ],
  async run({ values: { email = '', until }, flags }, { db, io, now }) {
    if (flags.revoke) {
      if (until !== undefined) {
        throw new UsageError('--until und --revoke schließen sich aus')
      }
      return revoke(db, email, io, now)
    }
    if (until === undefined) throw new UsageError('--until fehlt')
    // Before the database is asked, so a mistyped date changes nothing
    const heldUntil = untilDay(until)
    // Days of the form JJJJ-MM-TT compare as text
    if (until.trim() <= berlinDay(now)) {
      throw new CommandError(
        `--until muss ein Tag nach heute sein: "${until.trim()}"`,
      )
    }
    const account = await accountByEmail(db, email)
    const hold = await holdDeletion(db, account.id, heldUntil, now)
    if (hold.outcome === 'noSubscription') throw noSubscription(account.email)
    if (hold.outcome === 'kitasDeleted') {
      throw new CommandError(
        `Die Kitas von ${account.email} wurden bereits am ${longDate(hold.at)} gelöscht; da ist nichts mehr anzuhalten`,
      )
    }
    const { label } = describeSubscription(hold.subscription, now)
    io.stdout.write(
      `[admin] Löschung der Kitas von ${account.email} angehalten bis ` +
        `einschließlich ${longDate(lastMoment(heldUntil))} (Zustand: ${label}).\n` +
        '[admin] Eine schon verschickte Ankündigung der Löschung ist ' +
        'zurückgenommen; nach dem Anhalten folgt eine neue.\n',
    )
  },
}

function noSubscription(email: string) {
  return new CommandError(
    `${email} hat keinen Abo-Eintrag; ohne Eintrag wird nichts automatisch gelöscht`,
  )
}

// --revoke: the ordinary course again
async function revoke(db: Database, email: string, io: Io, now: Date) {
  const account = await accountByEmail(db, email)
  const subscription = await releaseDeletionHold(db, account.id, now)
  if (!subscription) throw noSubscription(account.email)
  const { label } = describeSubscription(subscription, now)
  io.stdout.write(
    `[admin] Löschung für ${account.email} nicht mehr angehalten (Zustand: ${label}).\n`,
  )
}
