import { addDays } from './time'
import { NOTE_DURATIONS } from './types'

// The rules of the „Neu“ marker on the Kita page. They don't touch the
// browser, so tests can call them directly; src/composables/use-seen-boards.ts
// keeps the record.

// When this device last looked at each board, by board id, as ISO times of
// the server's clock: the board page writes it, the Kita page reads it
export type SeenBoards = Record<string, string>

// The longest a note hangs: a visit longer ago than that says nothing any
// more about the notes there are now
const SEEN_KEPT_DAYS = Math.max(...NOTE_DURATIONS)

// Whether a board has a note newer than this device's last visit. A board
// never opened here has news as soon as anything hangs on it.
export function hasNews(latestNoteAt: string | null, seenAt?: string) {
  if (!latestNoteAt) return false
  return !seenAt || latestNoteAt > seenAt
}

// The record after a visit of `boardId` that saw everything up to `at`.
// Visits older than the longest a note hangs are dropped on the way: they
// would count as no visit anyway, and the record stays small.
export function markSeen(
  seen: SeenBoards,
  boardId: string,
  at: string,
  now: Date,
): SeenBoards {
  const oldest = addDays(now, -SEEN_KEPT_DAYS).toISOString()
  const kept = Object.entries(seen).filter(
    ([id, seenAt]) => id !== boardId && seenAt > oldest,
  )
  const previous = seen[boardId]
  const latest = previous && previous > at ? previous : at
  return Object.fromEntries([...kept, [boardId, latest]])
}
