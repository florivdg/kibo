<script setup lang="ts">
import { defaultNavigator, useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import BoardDescription from '@/components/board/BoardDescription.vue'
import BoardHeader from '@/components/board/BoardHeader.vue'
import CategoryFilter from '@/components/board/CategoryFilter.vue'
import { pillButtonClass } from '@/components/board/classes'
import EmptyState from '@/components/board/EmptyState.vue'
import NoteComposer from '@/components/board/NoteComposer.vue'
import NoteDetail from '@/components/board/NoteDetail.vue'
import NoteMasonry from '@/components/board/NoteMasonry.vue'
import BoardAlert from '@/components/board/BoardAlert.vue'
import { useAnnouncer } from '@/composables/use-announcer'
import { useAppBadge } from '@/composables/use-app-badge'
import {
  moreErrorMessage,
  pinErrorMessage,
  reportErrorMessage,
  takeDownErrorMessage,
  useBoardNotes,
} from '@/composables/use-board-notes'
import { useFormSubmit } from '@/composables/use-form-submit'
import { usePushBells } from '@/composables/use-push-bells'
import { useSeenBoards } from '@/composables/use-seen-boards'
import {
  landingAfterRemoval,
  restoreFocusAfterRemoval,
} from '@/lib/board/focus-after-removal'
import {
  isNewNotesMessage,
  newNotesAnnouncement,
} from '@/lib/board/push-client'
import type { Board, NoteDraft, NotePage } from '@/lib/board/types'
import type { OperatorReportOutcome, ReportDraft } from '@/lib/reports/types'

const props = defineProps<{
  board: Board
  // The first page; more notes are behind the button below
  initial: NotePage
  // Server time, so server and client render the same relative dates
  now: string
  privacyHref: string
  // Where a report of illegal content goes besides the Kita (OPERATOR_EMAIL);
  // empty: the report form doesn't offer it
  operatorEmail: string
}>()

const now = computed(() => new Date(props.now))
const {
  notes,
  hasMore,
  loadedUntil,
  status: moreStatus,
  statusRef: moreStatusRef,
  lastPinnedId,
  isOwn,
  prepareNote,
  pinNote,
  takeDownNote,
  reportNote,
  loadMore,
  loadNewest,
} = useBoardNotes(
  { kitaToken: props.board.kitaToken, boardId: props.board.id },
  props.initial,
)
const {
  state: pushState,
  status: pushStatus,
  bell,
  toggle: toggleBell,
  recount,
} = usePushBells(props.board.kitaToken, props.board.pushPublicKey, {
  // The page's sync counts this board as seen, up to what it shows, for the
  // app's icon
  seen: { boardId: props.board.id, until: () => newestSeen.value },
  onUnseen: useAppBadge().show,
})

// Opening the board is what the Kita page's „Neu“ marker counts from: this
// device has seen everything up to the page's server time, or up to the
// newest note of a page loaded since that leaves no gap — the one after its
// own post, say, or after a tap on a notification. Its own new note alone
// doesn't move it: others may have pinned notes in between that this page
// hasn't loaded. When that moves, the server hears it too, for the number
// on the app's icon; notes pinned after it keep counting there.
const seen = useSeenBoards()
const newestSeen = computed(() =>
  loadedUntil.value > props.now ? loadedUntil.value : props.now,
)
onMounted(() => {
  seen.markSeen(props.board.id, newestSeen.value)
  watch(newestSeen, (at) => {
    seen.markSeen(props.board.id, at)
    void recount()
  })
})

const selectedCategoryId = ref<string | null>(null)
const openNoteId = ref<string | null>(null)
const composerOpen = ref(false)
// Each action's error shows in its dialog
const {
  error: pinError,
  pending: pinPending,
  run: runPin,
} = useFormSubmit(pinErrorMessage)
const {
  error: takeDownError,
  pending: takeDownPending,
  run: runTakeDown,
} = useFormSubmit(takeDownErrorMessage)
const {
  error: reportError,
  pending: reportPending,
  run: runReport,
} = useFormSubmit(reportErrorMessage)
// The note whose report went through, for the thanks in its dialog, and
// what became of the mails to the operator (undefined: not asked for)
const reported = ref<{
  noteId: string
  operator: OperatorReportOutcome | undefined
} | null>(null)
const {
  error: moreError,
  pending: morePending,
  run: runLoadMore,
} = useFormSubmit(moreErrorMessage)

function openComposer() {
  pinError.value = null
  composerOpen.value = true
}

function openDetail(noteId: string) {
  takeDownError.value = null
  reportError.value = null
  reported.value = null
  openNoteId.value = noteId
}

const categoriesById = computed(
  () => new Map(props.board.categories.map((c) => [c.id, c])),
)

const counts = computed(() => {
  const result: Record<string, number> = {}
  for (const note of notes.value) {
    result[note.categoryId] = (result[note.categoryId] ?? 0) + 1
  }
  return result
})

const visibleNotes = computed(() =>
  selectedCategoryId.value === null
    ? notes.value
    : notes.value.filter((n) => n.categoryId === selectedCategoryId.value),
)

const openNote = computed(
  () => notes.value.find((n) => n.id === openNoteId.value) ?? null,
)

const selectedLabel = computed(() =>
  selectedCategoryId.value
    ? categoriesById.value.get(selectedCategoryId.value)?.label
    : undefined,
)

// With older notes still unloaded, "leer" would be wrong
const emptyText = computed(() => {
  const label = selectedLabel.value
  if (hasMore.value) {
    return label
      ? `Unter „${label}“ ist auf dieser Seite nichts dabei.`
      : 'Auf dieser Seite hängt nichts.'
  }
  return label
    ? `Gerade hängt nichts unter „${label}“.`
    : 'Das Brett ist noch leer.'
})

// Pinning and taking down happen in a dialog that closes afterwards; the
// outcome is announced here
const { status, announce } = useAnnouncer()

// A tap on a filter changes the notes far from the button, so the count is
// announced. Only on a tap: pinning resets the filter too, and says so itself.
function filteredText(label: string | undefined, count: number) {
  const found = `${count || 'Kein'} Zettel`
  if (label) return `${found} unter „${label}“.`
  return count > 1 ? `Alle ${found}.` : `${found}.`
}

function filterBy(categoryId: string | null) {
  selectedCategoryId.value = categoryId
  const text = filteredText(selectedLabel.value, visibleNotes.value.length)
  void announce(
    hasMore.value ? `${text} Ältere sind noch nicht geladen.` : text,
  )
}

// The note just pinned. It is scrolled to and focused once the composer has
// closed and handed the focus back to the button that opened it.
let pinnedId: string | null = null

function revealPinned() {
  const card = pinnedId && document.getElementById(`note-${pinnedId}`)
  pinnedId = null
  if (!card) return
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
  card.scrollIntoView({
    block: 'center',
    behavior: smooth ? 'smooth' : 'instant',
  })
  card.querySelector('button')?.focus({ preventScroll: true })
}

function revealOnceClosed(noteId: string) {
  pinnedId = noteId
  // Closed while the note was on its way: no close event is coming anymore
  if (!composerOpen.value) void nextTick(revealPinned)
}

// The composer clears its draft and closes when this resolves to true
async function pin(draft: NoteDraft) {
  const result = await runPin(() => pinNote(draft))
  if (!result?.data) return false
  // Make sure the new note is visible
  if (selectedCategoryId.value !== draft.categoryId) {
    selectedCategoryId.value = null
  }
  void announce('Zettel angepinnt.')
  revealOnceClosed(result.data.note.id)
  return true
}

// The dialog hands the focus back to what opened it, and a note taken down
// is gone: the focus goes to the note after it instead (the one before it at
// the end), or to the board when none is left or that one isn't shown any
// more. Remember its trigger as well, so a late response can leave focus
// where the visitor has moved it since.
const main = useTemplateRef<HTMLElement>('main')
interface TakeDownLanding {
  id: string | null
  trigger: HTMLButtonElement | null
}
let landing: TakeDownLanding | undefined

function noteButton(noteId: string | null) {
  if (!noteId) return null
  return (
    document.getElementById(`note-${noteId}`)?.querySelector('button') ?? null
  )
}

function focusedNoteId() {
  return (
    document.activeElement
      ?.closest<HTMLElement>('article[id^="note-"]')
      ?.id.slice(5) ?? null
  )
}

function takeDownLanding(before: string[], noteId: string): TakeDownLanding {
  const focusedId = focusedNoteId()
  return {
    id: landingAfterRemoval(before, noteId, focusedId),
    trigger: noteButton(focusedId ?? noteId),
  }
}

function landAfterTakeDown() {
  if (!landing) return
  const { id, trigger } = landing
  landing = undefined
  if (openNoteId.value !== null || composerOpen.value) return
  restoreFocusAfterRemoval(trigger, noteButton(id), document, main.value)
}

// Another note's dialog opened in the meantime keeps the focus it has
function landOnceClosed(noteId: string, focus: TakeDownLanding) {
  if (openNoteId.value === noteId) {
    landing = focus
    openNoteId.value = null
  } else if (openNoteId.value === null) {
    // Closed while the request was on its way: no close event is coming anymore
    landing = focus
    void nextTick(landAfterTakeDown)
  }
}

async function onTakeDown(noteId: string) {
  if (takeDownPending.value) return
  const before = visibleNotes.value.map(({ id }) => id)
  let focus = takeDownLanding(before, noteId)
  const done = await runTakeDown(() =>
    takeDownNote(noteId, () => (focus = takeDownLanding(before, noteId))),
  )
  // Still on the board: the error shows in the dialog. A note that was
  // already gone has been removed all the same.
  if (notes.value.some(({ id }) => id === noteId)) return
  landOnceClosed(noteId, focus)
  void announce(
    done ? 'Zettel abgenommen.' : 'Der Zettel hing schon nicht mehr.',
  )
}

// The report form stays open with its error; once the report is in, the
// dialog thanks the visitor (NoteReport.vue reads that out)
async function onReport(noteId: string, draft: ReportDraft) {
  const result = await runReport(() => reportNote(noteId, draft))
  if (result) reported.value = { noteId, operator: result.data }
}

// A tap on a notification while the board is open in a tab: the service
// worker focuses the tab and asks for the new notes. Open dialogs and older
// pages already loaded stay as they are.
async function showNewNotes(event: MessageEvent) {
  if (!isNewNotesMessage(event.data)) return
  const added = await loadNewest().catch(() => 0)
  if (added) void announce(newNotesAnnouncement(added))
}

// No navigator on the server; no service workers outside secure contexts
useEventListener(defaultNavigator?.serviceWorker, 'message', showNewNotes)
</script>

<template>
  <!-- The bar of BoardHeader sticks within this wrapper: to the end of the
       notes -->
  <div class="flex-1">
    <BoardHeader
      :board="board"
      :bell="bell(board.id)"
      :push-state="pushState"
      @toggle-bell="toggleBell(board.id, board.name)"
    />

    <!-- Focusable for the focus to land on once the last note is taken down -->
    <main
      ref="main"
      tabindex="-1"
      class="mx-auto max-w-6xl px-4 pt-3 pb-12 focus:outline-none sm:px-6 sm:pt-4"
    >
      <BoardDescription v-if="board.description" :text="board.description" />

      <!-- Reachable before the notes for keyboard and screen-reader users; the
           sticky button below is the last thing before the footer. -->
      <button
        type="button"
        class="bg-kirsche hover:bg-kirsche/90 focus-visible:outline-tinte sr-only rounded-full px-6 py-3 text-base font-bold text-white focus:not-sr-only focus:mt-6 focus:inline-block focus-visible:outline-3 focus-visible:outline-offset-3"
        @click="openComposer"
      >
        Zettel anpinnen
      </button>

      <CategoryFilter
        :model-value="selectedCategoryId"
        @update:model-value="filterBy"
        :categories="board.categories"
        :counts="counts"
        :total="notes.length"
      />

      <NoteMasonry
        v-if="visibleNotes.length"
        class="mt-8"
        :notes="visibleNotes"
        :categories-by-id="categoriesById"
        :now="now"
        :last-pinned-id="lastPinnedId"
        @open="openDetail"
      />

      <EmptyState
        v-if="!visibleNotes.length"
        class="mt-10"
        :title="emptyText"
        :hint="board.hints.emptyBoard"
      />

      <!-- Busy boards arrive one page at a time, newest first -->
      <div v-if="hasMore" class="mt-10 flex justify-center">
        <!-- Only says it is disabled while loading, so it keeps the focus;
             runLoadMore drops a second click -->
        <button
          type="button"
          :aria-disabled="morePending"
          class="border-tinte/25 hover:bg-tinte/5 border-2 font-semibold"
          :class="pillButtonClass"
          @click="runLoadMore(loadMore)"
        >
          {{ morePending ? 'Wird geladen …' : 'Ältere Zettel anzeigen' }}
        </button>
      </div>
      <BoardAlert class="mt-6" :message="moreError" />
      <p ref="moreStatusRef" tabindex="-1" role="status" class="sr-only">
        {{ moreStatus }}
      </p>
      <p role="status" class="sr-only">{{ status }}</p>
      <p role="status" class="sr-only">{{ pushStatus }}</p>
    </main>
  </div>

  <!-- The last thing on the page before the footer: sticks to the bottom of
       the screen while there are notes below, and comes to rest above the
       footer at the end instead of covering it. data-sticky-pin keeps the
       focus clear of it (scroll-padding in src/styles/frontend.css). -->
  <div
    data-sticky-pin
    class="pointer-events-none sticky bottom-0 flex justify-end px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:pb-8"
  >
    <button
      type="button"
      class="bg-kirsche hover:bg-kirsche/90 focus-visible:outline-tinte pointer-events-auto rounded-full px-6 py-4 text-lg font-bold text-white shadow-[0_12px_24px_-10px_rgb(34_48_74/0.7)] focus-visible:outline-3 focus-visible:outline-offset-3"
      @click="openComposer"
    >
      Zettel anpinnen
    </button>
  </div>

  <NoteDetail
    :note="openNote"
    :category="openNote ? categoriesById.get(openNote.categoryId) : undefined"
    :now="now"
    :own="!!openNote && isOwn(openNote.id)"
    :pending="takeDownPending"
    :error="takeDownError"
    :report-pending="reportPending"
    :report-error="reportError"
    :reported="!!openNote && reported?.noteId === openNote.id"
    :operator="reported?.operator"
    :operator-email="operatorEmail"
    :privacy-href="privacyHref"
    @close="openNoteId = null"
    @closed="landAfterTakeDown"
    @take-down="openNote && onTakeDown(openNote.id)"
    @report="openNote && onReport(openNote.id, $event)"
    @reset-report="reportError = null"
  />
  <NoteComposer
    :open="composerOpen"
    :categories="board.categories"
    :hints="board.hints"
    :initial-category-id="selectedCategoryId"
    :pending="pinPending"
    :error="pinError"
    :privacy-href="privacyHref"
    :prepare="prepareNote"
    :pin="pin"
    @close="composerOpen = false"
    @closed="revealPinned"
  />
</template>
