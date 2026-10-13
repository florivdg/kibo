import type { BoardCategory, BoardHints } from './types'

// Every board has a fixed type; the type decides the note categories and
// their paper colours. Stored in the database by id, so ids must not change.
export const BOARD_TYPE_IDS = ['fundkiste', 'biete-suche', 'pinnwand'] as const

export type BoardType = (typeof BOARD_TYPE_IDS)[number]

interface BoardTypeDefinition {
  label: string
  summary: string
  categories: BoardCategory[]
  hints: BoardHints
}

export const BOARD_TYPES: Record<BoardType, BoardTypeDefinition> = {
  fundkiste: {
    label: 'Fundkiste',
    summary: 'Verlorenes suchen und Gefundenes melden.',
    categories: [
      { id: 'gesucht', label: 'Gesucht', tone: 'sonne' },
      { id: 'gefunden', label: 'Gefunden', tone: 'gras' },
    ],
    hints: {
      titlePlaceholder: 'z. B. Blaue Mütze mit Fuchs',
      bodyPlaceholder: 'Wo und wann? Wie sieht es aus?',
      emptyBoard:
        'Hast du etwas verloren oder gefunden? Pinne den ersten Zettel an.',
    },
  },
  'biete-suche': {
    label: 'Biete & Suche',
    summary: 'Kurse, Fahrgemeinschaften, Kindersachen zu verschenken.',
    categories: [
      { id: 'biete', label: 'Biete', tone: 'rosa' },
      { id: 'suche', label: 'Suche', tone: 'flieder' },
    ],
    hints: {
      titlePlaceholder: 'z. B. Fahrgemeinschaft zum Schwimmkurs',
      bodyPlaceholder: 'Was genau? Wann und wo?',
      emptyBoard:
        'Möchtest du etwas anbieten oder suchst du etwas? Pinne den ersten Zettel an.',
    },
  },
  pinnwand: {
    label: 'Pinnwand',
    summary: 'Hinweise, Fragen und Termine von Familien.',
    categories: [
      { id: 'hinweis', label: 'Hinweis', tone: 'sonne' },
      { id: 'frage', label: 'Frage', tone: 'flieder' },
      { id: 'termin', label: 'Termin', tone: 'gras' },
    ],
    hints: {
      titlePlaceholder: 'z. B. Laternenumzug am Freitag',
      bodyPlaceholder: 'Was ist los? Wann und wo?',
      emptyBoard:
        'Hast du einen Hinweis, eine Frage oder einen Termin? Pinne den ersten Zettel an.',
    },
  },
}

export function hasCategory(type: BoardType, categoryId: string) {
  return BOARD_TYPES[type].categories.some(({ id }) => id === categoryId)
}
