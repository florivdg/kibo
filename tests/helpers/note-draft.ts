import type { BoardLink, NoteDraft } from '@/lib/board/types'
import { NOTE_FORM_TOKEN_MIN_AGE_MS } from '@/lib/limits'
import { issueNoteFormToken } from '@/lib/spam/guard'

// A form token for this board the way the composer sends it: issued a little
// longer ago than the server makes it wait (src/lib/spam/form-token.ts)
export function ripeFormToken(boardId: string, now = new Date()) {
  return issueNoteFormToken(
    boardId,
    new Date(now.getTime() - NOTE_FORM_TOKEN_MIN_AGE_MS - 1000),
  )
}

// What the composer sends to notes.create for a note on this board, with a
// ripe form token; `overrides` changes any part of it
export async function noteDraft(
  link: BoardLink,
  overrides: Partial<
    NoteDraft & { formToken: string; ownEndpoint: string }
  > = {},
) {
  return {
    ...link,
    categoryId: 'hinweis',
    title: 'Laternenfest',
    body: 'Am Freitag um fünf im Garten.',
    author: 'Anna',
    contact: '',
    durationDays: 14 as const,
    website: '',
    formToken: await ripeFormToken(link.boardId),
    ...overrides,
  }
}
