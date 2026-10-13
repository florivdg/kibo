// Shapes the public board UI works with

export type NoteTone = 'sonne' | 'gras' | 'rosa' | 'flieder'

export interface BoardCategory {
  id: string
  label: string
  tone: NoteTone
}

// Wording that depends on the board type
export interface BoardHints {
  titlePlaceholder: string
  bodyPlaceholder: string
  emptyBoard: string
}

// A board as the public pages and actions name it: the Kita link it is
// opened through, and its id within that Kita (src/lib/board/kita-link.ts)
export interface BoardLink {
  kitaToken: string
  boardId: string
}

export interface Board {
  id: string
  // The Kita link the board was opened through (src/lib/board/paths.ts)
  kitaToken: string
  name: string
  kitaName: string
  description: string
  categories: BoardCategory[]
  hints: BoardHints
  // Web push for new notes: the VAPID public key to subscribe with, or null
  // when the instance has no push configured or the Kita switched it off
  pushPublicKey: string | null
}

// A board's card on the Kita page. `latestNoteAt`: when its newest current
// note was pinned, null without one.
export interface KitaBoard {
  id: string
  name: string
  description: string
  noteCount: number
  latestNoteAt: string | null
  // Whether visitors may turn on notifications for it
  pushEnabled: boolean
}

export interface Note {
  id: string
  categoryId: string
  title: string
  body: string
  author: string
  contact?: string
  createdAt: string
  expiresAt: string
}

// Where a page of notes ended, and the page itself
export interface NoteCursor {
  createdAt: string
  id: string
}

export interface NotePage {
  notes: Note[]
  hasMore: boolean
}

export interface NoteDraft {
  categoryId: string
  title: string
  body: string
  author: string
  contact: string
  durationDays: NoteDuration
  // Honeypot: hidden from people, bots tend to fill it in
  website: string
}

export const NOTE_DURATIONS = [7, 14, 30] as const
export type NoteDuration = (typeof NOTE_DURATIONS)[number]

export const NOTE_TITLE_MAX = 60
export const NOTE_BODY_MAX = 400
export const NOTE_AUTHOR_MAX = 60
export const NOTE_CONTACT_MAX = 120

export const BOARD_NAME_MAX = 80
export const BOARD_DESCRIPTION_MAX = 300
