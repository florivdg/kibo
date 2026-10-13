import { and, asc, desc, eq, gt } from 'drizzle-orm'

import { db } from '@/db'
import { board, note, organization } from '@/db/schema'
import type { Database } from '@/db/types'
import { slugBase } from '@/lib/organization-slug'

import { BOARD_TYPES, type BoardType } from './board-types'
import { publicNoteColumns } from './queries'
import { berlinDay } from './time'
import type { Note } from './types'

// A Kita's data as one JSON document, for taking it to another instance or
// keeping it (EU Data Act, Art. 25/26; GDPR Art. 28(3)(g)). The format is
// public and versioned: every field is described in
// docs/selbst-hosten/datenexport.md, which is the register of the format.
// Changing what a field means or removing one needs a new version there and
// here; adding one does too, so a reader can rely on what version 1 says.
//
// What it holds: the Kita's name, its boards with their type, categories and
// settings, and the notes that are current at `exportedAt`. Never the Kita
// link (a capability), delete-key hashes, push subscriptions, report cases,
// members or invitations.

export const KITA_EXPORT_FORMAT = 'kibo-kita-export'
export const KITA_EXPORT_VERSION = 1

// A note as the board shows it, with `contact: null` rather than left out, so
// every field of the format is always there
export type ExportedNote = Omit<Note, 'contact'> & { contact: string | null }

export interface ExportedBoard {
  id: string
  type: BoardType
  typeLabel: string
  categories: { id: string; label: string }[]
  name: string
  description: string
  pushEnabled: boolean
  createdAt: string
  updatedAt: string
  // Newest first, as on the board
  notes: ExportedNote[]
}

export interface KitaExport {
  format: typeof KITA_EXPORT_FORMAT
  version: typeof KITA_EXPORT_VERSION
  exportedAt: string
  kita: { name: string }
  // Oldest board first, as in the admin list
  boards: ExportedBoard[]
}

type NoteRow = Pick<
  typeof note.$inferSelect,
  keyof typeof publicNoteColumns | 'boardId'
>

// The current notes by board, as the document writes them
function notesByBoard(rows: NoteRow[]) {
  const byBoard = new Map<string, ExportedNote[]>()
  for (const { boardId, createdAt, expiresAt, ...rest } of rows) {
    const notes = byBoard.get(boardId) ?? []
    notes.push({
      ...rest,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    byBoard.set(boardId, notes)
  }
  return byBoard
}

// The three reads see the same moment: a note pinned or a board renamed in
// between can't leave a board without its notes or notes without their board
async function readKita(organizationId: string, now: Date, on: Database) {
  return on.transaction(
    async (tx) => {
      const [kita] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
      if (!kita) return undefined
      const boards = await tx
        .select({
          id: board.id,
          type: board.type,
          name: board.name,
          description: board.description,
          pushEnabled: board.pushEnabled,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
        })
        .from(board)
        .where(eq(board.organizationId, organizationId))
        .orderBy(asc(board.createdAt), asc(board.id))
      const notes = await tx
        .select({ ...publicNoteColumns, boardId: note.boardId })
        .from(note)
        .innerJoin(board, eq(note.boardId, board.id))
        .where(
          and(
            eq(board.organizationId, organizationId),
            gt(note.expiresAt, now),
          ),
        )
        .orderBy(desc(note.createdAt), desc(note.id))
      return { kita, boards, notes }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

// The export of one Kita at `now`, or undefined when there is no such Kita.
// Whoever calls it has checked that the user belongs to the Kita.
export async function kitaExport(
  organizationId: string,
  now: Date,
  on: Database = db,
): Promise<KitaExport | undefined> {
  const found = await readKita(organizationId, now, on)
  if (!found) return undefined
  const notes = notesByBoard(found.notes)
  return {
    format: KITA_EXPORT_FORMAT,
    version: KITA_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    kita: { name: found.kita.name },
    boards: found.boards.map(({ createdAt, updatedAt, ...row }) => {
      const { label, categories } = BOARD_TYPES[row.type]
      return {
        ...row,
        typeLabel: label,
        categories: categories.map(({ id, label }) => ({ id, label })),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        notes: notes.get(row.id) ?? [],
      }
    }),
  }
}

// The file it is saved as: plain ASCII, so the header needs no encoding —
// kibo-kita-sonnenschein-2026-10-05.json, the day in Berlin
export function kitaExportFilename(kitaName: string, now: Date) {
  return `kibo-${slugBase(kitaName) || 'kita'}-${berlinDay(now)}.json`
}
