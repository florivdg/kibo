import { parse } from 'devalue'
import type { Fixture } from './config'
export function listInput(fixture: Fixture) {
  return JSON.stringify({
    kitaToken: fixture.token,
    boardId: fixture.boardId,
    cursor: fixture.cursor,
  })
}
export function validOlderPage(body: string, fixture: Fixture) {
  try {
    const page = parse(body) as {
      notes: { id: string; title: string; createdAt: string }[]
      hasMore: boolean
    }
    return (
      page.notes.length === 40 &&
      page.hasMore === true &&
      page.notes.every(
        (note, index) =>
          note.title === `Synthetischer Zettel ${40 + index}` &&
          !!fixture.cursor &&
          Date.parse(note.createdAt) < Date.parse(fixture.cursor.createdAt) &&
          (index === 0 ||
            Date.parse(note.createdAt) <
              Date.parse(page.notes[index - 1]!.createdAt)),
      )
    )
  } catch {
    return false
  }
}
