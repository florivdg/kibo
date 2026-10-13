import { actions } from 'astro:actions'
import { computed, ref } from 'vue'

import { useNotePager } from '@/composables/use-note-pager'
import { useOwnNoteKeys } from '@/composables/use-own-note-keys'
import { ownPushEndpoint } from '@/composables/use-push-bells'
import { messagesFor, withSpamMessages } from '@/composables/visitor-errors'
import { formTokens } from '@/lib/board/form-token-client'
import type {
  BoardLink,
  NoteCursor,
  NoteDraft,
  NotePage,
} from '@/lib/board/types'
import { HOSTED_PAUSED_VISITOR } from '@/lib/hosted/messages'
import type { ReportDraft } from '@/lib/reports/types'

// The Kita was paused on the hosted instance while the page was open
// (src/lib/hosted/access.ts)
const PAUSED = { PAYMENT_REQUIRED: HOSTED_PAUSED_VISITOR }

export const pinErrorMessage = withSpamMessages(
  messagesFor({
    ...PAUSED,
    BAD_REQUEST: 'Bitte prüf deine Eingaben.',
    TOO_MANY_REQUESTS:
      'Du hast gerade sehr viele Zettel angepinnt. Versuch es in ein paar Minuten nochmal.',
    CONFLICT: 'Dieser Zettel hängt hier schon.',
    // Reloading would lose the draft and only show the not-found page
    NOT_FOUND:
      'Unter diesem Link gibt es das Brett nicht mehr. Vielleicht hat die Kita einen neuen Link verschickt.',
  }),
)

export const moreErrorMessage = messagesFor({
  ...PAUSED,
  NOT_FOUND:
    'Unter diesem Link gibt es das Brett nicht mehr. Vielleicht hat die Kita einen neuen Link verschickt.',
})

// NOT_FOUND needs no message: the note is removed from the board anyway
export const takeDownErrorMessage = messagesFor({})

// The limits of reporting word their own message (src/lib/spam/guard.ts)
export const reportErrorMessage = withSpamMessages(
  messagesFor({
    ...PAUSED,
    BAD_REQUEST:
      'Bitte wähl einen Grund aus und prüf deinen Hinweis und deine Angaben.',
    NOT_FOUND:
      'Diesen Zettel gibt es hier nicht mehr: Er ist abgenommen oder abgelaufen, oder die Kita hat einen neuen Link verschickt.',
  }),
)

// A note taken down leaves the page, and so does one the server no longer
// knows (expired, or taken down in another tab) instead of hanging on as a
// ghost. Its key stays in the latter case: if the Kita renewed the link, the
// note still hangs under the new one, and expired keys are dropped anyway.
function leavesPage(error?: { code: string }) {
  return !error || error.code === 'NOT_FOUND'
}

// Note state for one board, synced with the board actions. All actions
// resolve to the action result, for useFormSubmit to handle errors.
// A busy board is only sent one page at a time; loadMore fetches the next.
export function useBoardNotes(link: BoardLink, initial: NotePage) {
  const pager = useNotePager(
    (cursor?: NoteCursor) => actions.notes.list({ ...link, cursor }),
    initial,
  )
  const { notes, loadNewest } = pager
  const lastPinnedId = ref<string | null>(null)
  const ownKeys = useOwnNoteKeys()
  const formToken = formTokens(() => actions.notes.formToken(link))

  const sortedNotes = computed(() =>
    notes.value.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
  )

  function isOwn(noteId: string) {
    return !!ownKeys.keyFor(noteId)
  }

  // The note with a form token, or why there is none to send it with.
  // Whoever pins a note isn't notified of it on this board; finding out their
  // endpoint and waiting for the token to ripen run side by side.
  async function sendNote(draft: NoteDraft) {
    const [ownEndpoint, { token, error }] = await Promise.all([
      ownPushEndpoint(),
      formToken.ready(),
    ])
    if (error) return { data: undefined, error }
    const result = await actions.notes.create({
      ...link,
      ...draft,
      formToken: token,
      ownEndpoint,
    })
    // A token the server didn't take is not sent again: the next try fetches
    // a new one, and the text stays where it is
    if (result.error?.code === 'BAD_REQUEST') formToken.discard()
    return result
  }

  async function pinNote(draft: NoteDraft) {
    const result = await sendNote(draft)
    if (result.data) {
      const { note, deleteKey } = result.data
      notes.value = [note, ...notes.value]
      ownKeys.add(note, deleteKey)
      lastPinnedId.value = note.id
      // The newest page brings the notes pinned elsewhere since this one
      // loaded, and only with them does loadedUntil move past the new note
      void loadNewest().catch(() => undefined)
    }
    return result
  }

  async function takeDownNote(
    noteId: string,
    beforeRemove: () => void = () => undefined,
  ) {
    const deleteKey = ownKeys.keyFor(noteId) ?? ''
    const result = await actions.notes.remove({ ...link, noteId, deleteKey })
    if (leavesPage(result.error)) {
      // Snapshot focus before masonry redistributes and remounts its cards.
      beforeRemove()
      notes.value = notes.value.filter(({ id }) => id !== noteId)
    }
    if (!result.error) ownKeys.remove(noteId)
    return result
  }

  // The server reads the note itself; nothing of it travels along. Name and
  // address of whoever reports only go along with the operator option.
  function reportNote(
    noteId: string,
    {
      reason,
      remarks,
      website,
      toOperator,
      notifierName,
      notifierEmail,
      goodFaith,
    }: ReportDraft,
  ) {
    return actions.notes.report({
      ...link,
      noteId,
      // An empty reason is refused by the server as invalid input
      reason: reason as Exclude<ReportDraft['reason'], ''>,
      remarks,
      website,
      operator: toOperator
        ? {
            name: notifierName,
            email: notifierEmail,
            // Without the statement the server refuses the report the same way
            goodFaith: goodFaith as true,
          }
        : undefined,
    })
  }

  return {
    ...pager,
    notes: sortedNotes,
    lastPinnedId,
    isOwn,
    // For the composer to call when it opens
    prepareNote: formToken.prepare,
    pinNote,
    takeDownNote,
    reportNote,
  }
}
