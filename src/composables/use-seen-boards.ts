import { useMounted } from '@vueuse/core'

import { useDeviceRecord } from '@/composables/use-device-record'
import { hasNews, markSeen, type SeenBoards } from '@/lib/board/seen-boards'

// When this device last opened each board, for the „Neu“ marker on the Kita
// page. Only in this browser (or installed app, which keeps storage of its
// own); the server never hears of it. Written only once a board was opened
// here (useDeviceRecord). `window` only for tests.
export function useSeenBoards(window?: Window) {
  const seen = useDeviceRecord<SeenBoards>('kibo:seen', window)

  // The server knows nothing of the visits: no marker before they are read,
  // rather than one for every board that vanishes a moment later
  const loaded = useMounted()

  return {
    hasNews: (boardId: string, latestNoteAt: string | null) =>
      loaded.value && hasNews(latestNoteAt, seen.value?.[boardId]),
    // `at`: the newest moment the visit saw, in the server's clock
    markSeen(boardId: string, at: string) {
      seen.value = markSeen(seen.value ?? {}, boardId, at, new Date())
    },
  }
}
