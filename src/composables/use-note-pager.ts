import { nextTick, ref } from 'vue'

import type { SubmitResult } from '@/composables/use-form-submit'
import type { Note, NoteCursor, NotePage } from '@/lib/board/types'

interface PageResult extends SubmitResult {
  data?: NotePage
}

const cursorOf = (note?: Note): NoteCursor | undefined =>
  note && { createdAt: note.createdAt, id: note.id }

// Paging for a board's notes, shared by the public board and the admin table:
// the notes on screen, whether there are older ones, and the wording a screen
// reader hears when a page arrives.
export function useNotePager(
  fetchPage: (cursor?: NoteCursor) => Promise<PageResult>,
  initial: NotePage,
) {
  const notes = ref<Note[]>(initial.notes)
  const hasMore = ref(initial.hasMore)
  // New notes appear far from the button, so the count is announced politely;
  // and when the last page removes the button, the focus would otherwise fall
  // back to the document — it moves to the message instead.
  const status = ref('')
  const statusRef = ref<HTMLElement | null>(null)

  async function announce(added: number, more: boolean) {
    const loaded =
      added === 1
        ? 'Ein weiterer Zettel geladen.'
        : `${added} weitere Zettel geladen.`
    status.value = more ? loaded : `${loaded} Das waren alle.`
    if (more) return
    await nextTick()
    statusRef.value?.focus({ preventScroll: true })
  }

  // The notes of a page that aren't on screen yet
  function unseen(page: Note[]) {
    const known = new Set(notes.value.map(({ id }) => id))
    return page.filter(({ id }) => !known.has(id))
  }

  // The notes the server has sent since the list was last restarted; a note
  // put on screen by other means, such as one just pinned here, isn't one
  let served = new Set(initial.notes.map(({ id }) => id))
  let newestServed = initial.notes[0]?.createdAt ?? ''
  // How far up the screen holds every note there is ('' before any). It
  // stays put while a restarted list leaves notes out between its end and
  // there, until "Ältere Zettel anzeigen" reaches down to it again.
  const loadedUntil = ref(newestServed)
  let gap = false

  function serve(page: NotePage) {
    for (const { id, createdAt } of page.notes) {
      served.add(id)
      if (createdAt > newestServed) newestServed = createdAt
    }
    if (!gap && newestServed > loadedUntil.value) {
      loadedUntil.value = newestServed
    }
  }

  // Older pages go on from the oldest note the server has sent for the
  // current list, not from the last one on screen: that may have been taken
  // down since, and a keyset cursor works without the note
  let cursor = cursorOf(initial.notes.at(-1))
  // Bumped when loadNewest restarts the list. An answer asked for before
  // that is dropped: a page fetched with the old list's cursor would land
  // under the restarted one, close its gap and lift loadedUntil over notes
  // never loaded.
  let generation = 0

  async function loadMore() {
    const asked = generation
    const result = await fetchPage(cursor)
    if (!result.data || asked !== generation) return result

    // A note pinned in the meantime can show up in both, so ids already on
    // screen are skipped
    const added = unseen(result.data.notes)
    notes.value = [...notes.value, ...added]
    hasMore.value = result.data.hasMore
    const last = result.data.notes.at(-1)
    if (!hasMore.value || (last && last.createdAt <= loadedUntil.value)) {
      gap = false
    }
    cursor = cursorOf(last) ?? cursor
    serve(result.data)
    await announce(added.length, hasMore.value)
    return result
  }

  // The newest page again, e.g. after a tap on a notification or a post;
  // resolves to the number of notes that are new here. New notes go on top
  // and older pages already loaded stay. When the page shares no note the
  // server sent before but there are older ones behind it, more notes came
  // in than fit on a page: the page restarts the list so "Ältere Zettel
  // anzeigen" doesn't skip the gap.
  async function loadNewest() {
    const asked = generation
    const { data } = await fetchPage()
    if (!data || asked !== generation) return 0
    const added = unseen(data.notes)
    if (data.hasMore && !data.notes.some(({ id }) => served.has(id))) {
      notes.value = data.notes
      hasMore.value = true
      served = new Set()
      gap = true
      cursor = cursorOf(data.notes.at(-1))
      generation++
    } else {
      notes.value = [...added, ...notes.value]
      if (!data.hasMore) gap = false
    }
    serve(data)
    return added.length
  }

  return {
    notes,
    hasMore,
    loadedUntil,
    status,
    statusRef,
    loadMore,
    loadNewest,
  }
}
