import { getCollection, render } from 'astro:content'

// Every page's title by id: its one `# ` heading, as the renderer read it
async function readTitles(): Promise<ReadonlyMap<string, string>> {
  const titles = new Map<string, string>()
  for (const entry of await getCollection('docs')) {
    const { headings } = await render(entry)
    const heading = headings.find(({ depth }) => depth === 1)
    if (heading) titles.set(entry.id, heading.text)
  }
  return titles
}

// Read once per process: the pages are part of the build and change with a
// deployment, not while the server runs
let titles: ReturnType<typeof readTitles> | undefined

export function docTitles() {
  // `astro dev` renders a page again when its file changes
  if (import.meta.env.DEV) return readTitles()
  return (titles ??= readTitles())
}
