import {
  removeNoteAsOperator,
  type OperatorTakedownCase,
} from '@/lib/reports/takedown'

import { CommandError, type Command } from './command'

// The operator's answer to a notice of illegal content (DSA Art. 16): the
// mail about it names the note's id and this call. The operator has no
// account in the Kita; this takes the note down on any board and records it
// on the note's case — the open one, or else the newest one the Kita closed
// keeping the note — as removed by the operator, which the Kita then sees
// under „Meldungen“.

// A note's id is a UUID; anything else is refused before the database sees it
const NOTE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CASE_LINES: Record<OperatorTakedownCase, string> = {
  closed: 'Der offene Meldungsfall der Kita ist als entfernt abgeschlossen.',
  updated:
    'Der von der Kita abgeschlossene Meldungsfall ist jetzt als vom Betreiber entfernt vermerkt.',
  none: 'Zu diesem Zettel gab es keinen Meldungsfall.',
}

export const removeNoteCommand: Command = {
  summary:
    'Nimmt einen gemeldeten Zettel ab (Hinweis auf rechtswidrige Inhalte)',
  options: {
    id: { value: 'zettel-id', help: 'Kennung des Zettels aus der Meldung' },
  },
  notes: [
    'Der Zettel wird sofort gelöscht; der Meldungsfall der Kita – der offene,',
    'sonst der zuletzt von ihr abgeschlossene – wird als „vom Betreiber',
    'entfernt“ vermerkt. Die Entscheidung teilen Sie der meldenden Person',
    'selbst per E-Mail mit.',
  ],
  async run({ values: { id = '' } }, { db, io, now }) {
    const noteId = id.trim()
    if (!NOTE_ID.test(noteId)) {
      throw new CommandError(`Keine gültige Zettel-ID: ${noteId}`)
    }
    const removed = await removeNoteAsOperator(db, noteId, now)
    if (!removed) {
      throw new CommandError(
        `Kein Zettel mit der Kennung ${noteId} – schon abgenommen oder abgelaufen`,
      )
    }
    const { title, boardName, kitaName, reportCase } = removed
    io.stdout.write(
      `[admin] Zettel „${title}“ vom Brett „${boardName}“ der Kita „${kitaName}“ entfernt.\n` +
        `[admin] ${CASE_LINES[reportCase]}\n`,
    )
  },
}
