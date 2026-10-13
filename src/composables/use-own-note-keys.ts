import { tryOnMounted } from '@vueuse/core'

import { useDeviceRecord } from '@/composables/use-device-record'
import { liveOwnNotes, type OwnNotes } from '@/lib/board/own-notes'
import type { Note } from '@/lib/board/types'

// Delete keys of notes pinned from this browser (src/lib/board/own-notes.ts).
// Only written once a note is pinned here; other tabs' changes arrive through
// the storage event, so writes never drop their keys. Every write, and the
// first read, forgets the keys of notes that have expired by now, and the
// entry goes once none is left.
export function useOwnNoteKeys(window?: Window) {
  const keys = useDeviceRecord<OwnNotes>('kibo:own-notes', window)

  function write(change: (current: OwnNotes) => void = () => undefined) {
    const current = liveOwnNotes(keys.value, new Date()) ?? {}
    change(current)
    keys.value = Object.keys(current).length ? current : null
  }

  // After the record was read (registered after it, so it runs after it):
  // whatever expired since the last visit goes now, not with the next note
  tryOnMounted(() => {
    if (keys.value) write()
  })

  return {
    keyFor: (noteId: string) => keys.value?.[noteId]?.key,
    add: (note: Note, key: string) =>
      write(
        (current) => (current[note.id] = { key, expiresAt: note.expiresAt }),
      ),
    remove: (noteId: string) => write((current) => delete current[noteId]),
  }
}
