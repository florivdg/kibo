import type { Fixture } from './config'
interface PageResponse {
  status: number
  contentType: string
  body: unknown
}
function visibleText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
}
export function validPage(
  response: PageResponse,
  fixture: Fixture,
  board: boolean,
) {
  if (
    response.status !== 200 ||
    !response.contentType.includes('text/html') ||
    typeof response.body !== 'string'
  )
    return false
  const text = visibleText(response.body)
  if (
    ![fixture.name, 'Synthetisches Brett'].every((value) =>
      text.includes(value),
    )
  )
    return false
  return board
    ? validBoardText(text, fixture.count)
    : validKitaText(text, fixture.count)
}
function validKitaText(text: string, count: number) {
  const label = count === 0 ? 'Noch keine Zettel' : `${count} Zettel`
  return text.includes('Alle Bretter eurer Kita.') && text.includes(label)
}
function validBoardText(text: string, count: number) {
  const titles = [...text.matchAll(/Synthetischer Zettel (\d+)\b/g)].map(
    (match) => Number(match[1]),
  )
  if (count === 0)
    return titles.length === 0 && text.includes('Das Brett ist noch leer.')
  return (
    titles.length === Math.min(count, 40) &&
    titles.every((id, index) => id === index)
  )
}
