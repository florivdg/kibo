import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { Glob } from 'bun'
import { describe, expect, test } from 'bun:test'
import GithubSlugger from 'github-slugger'
import { marked, type Token } from 'marked'

import { hasScheme, rewriteDocLink } from '@/lib/docs/doc-links'
import {
  DOCS_ORDER,
  DOCS_SECTIONS,
  docsFile,
  docsPath,
} from '@/lib/docs/navigation'
import { docSummary } from '@/lib/docs/pages'

// The documentation is read in two places: as Markdown on GitHub and as pages
// under /docs. These tests walk the files in docs/ themselves, so a link that
// leads nowhere, an anchor without its heading or a page nobody can reach is
// found without building the site.

const DOCS = resolve(import.meta.dir, '../docs')
const REPO = dirname(DOCS)

interface Doc {
  // Path below docs/, e.g. `fuer-kitas/zettel.md`
  file: string
  source: string
  // Heading depths, and the ids GitHub (and Astro) give the headings
  depths: number[]
  anchors: Set<string>
  links: string[]
  images: string[]
  // What a reader reads: text outside code
  prose: string[]
}

// The text of a heading the way it is rendered, which is what the id is
// made from
function inlineText(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((token) =>
      'tokens' in token && token.tokens
        ? inlineText(token.tokens)
        : 'text' in token
          ? token.text
          : '',
    )
    .join('')
}

function readDoc(file: string): Doc {
  const source = readFileSync(resolve(DOCS, file), 'utf8')
  const slugger = new GithubSlugger()
  const doc: Doc = {
    file,
    source,
    depths: [],
    anchors: new Set(),
    links: [],
    images: [],
    prose: [],
  }
  // Nothing to wait for: the callback is synchronous
  void marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === 'heading') {
      doc.depths.push(token.depth)
      doc.anchors.add(slugger.slug(inlineText(token.tokens)))
    } else if (token.type === 'link') {
      doc.links.push(token.href)
    } else if (token.type === 'image') {
      doc.images.push(token.href)
    } else if (token.type === 'text' && !('tokens' in token && token.tokens)) {
      doc.prose.push(token.text)
    }
  })
  return doc
}

const docs = new Map(
  [...new Glob('**/*.md').scanSync({ cwd: DOCS })]
    .sort()
    .map((file) => [file, readDoc(file)]),
)

// What has to be a page: the index and everything in a section's directory.
// The files left at the old addresses are checked as well, but are no pages.
const pages = [...docs.values()].filter(
  ({ file }) => file === 'README.md' || file.includes('/'),
)
const sectionIds = DOCS_SECTIONS.flatMap((section) => section.ids)

// Where a relative link leads: the file, and the anchor in it
function target(doc: Doc, url: string) {
  const [path, anchor] = url.split('#')
  const absolute = path
    ? resolve(DOCS, dirname(doc.file), decodeURI(path))
    : resolve(DOCS, doc.file)
  return {
    absolute,
    file: relative(DOCS, absolute),
    anchor: anchor === undefined ? undefined : decodeURIComponent(anchor),
  }
}

const relativeLinks = [...docs.values()].flatMap((doc) =>
  doc.links.filter((url) => !hasScheme(url)).map((url) => ({ doc, url })),
)

describe('the files in docs/', () => {
  test('are found', () => {
    expect(pages.length).toBeGreaterThan(sectionIds.length)
    expect(relativeLinks.length).toBeGreaterThan(50)
  })

  test('link to files that exist', () => {
    const broken = relativeLinks
      .filter(({ doc, url }) => {
        const { absolute } = target(doc, url)
        return (
          relative(REPO, absolute).startsWith('..') || !existsSync(absolute)
        )
      })
      .map(({ doc, url }) => `${doc.file}: ${url}`)
    expect(broken).toEqual([])
  })

  test('link to anchors that are headings of the target', () => {
    const broken = relativeLinks
      .filter(({ doc, url }) => {
        const { file, anchor } = target(doc, url)
        if (anchor === undefined) return false
        return !docs.get(file)?.anchors.has(anchor)
      })
      .map(({ doc, url }) => `${doc.file}: ${url}`)
    expect(broken).toEqual([])
  })

  test('show images that exist in docs/screenshots', () => {
    const images = [...docs.values()].flatMap((doc) =>
      doc.images.map((url) => ({ doc, ...target(doc, url) })),
    )
    expect(images.length).toBeGreaterThan(0)
    const broken = images
      .filter(
        ({ file, absolute }) =>
          !file.startsWith('screenshots/') || !existsSync(absolute),
      )
      .map(({ doc, file }) => `${doc.file}: ${file}`)
    expect(broken).toEqual([])
  })
})

describe('the pages under /docs', () => {
  // GitHub would show frontmatter as a table above the text
  test('have no frontmatter and exactly one title', () => {
    for (const { file, source, depths } of pages) {
      expect(source.startsWith('---'), file).toBe(false)
      expect(depths[0], file).toBe(1)
      expect(
        depths.filter((depth) => depth === 1),
        file,
      ).toHaveLength(1)
    }
  })

  test('start with a paragraph that can serve as their description', () => {
    for (const { file, source } of pages) {
      expect(docSummary(source)?.length ?? 0, file).toBeGreaterThan(20)
    }
  })

  // The navigation is what the site serves (src/content.config.ts), so a
  // file it doesn't list would be a page nobody gets to read
  test('are exactly the pages of the navigation', () => {
    expect(pages.map(({ file }) => file).sort()).toEqual(
      DOCS_ORDER.map(docsFile).sort(),
    )
    expect(new Set(DOCS_ORDER).size).toBe(DOCS_ORDER.length)
  })

  test('sit in the directory of their section', () => {
    const [forKitas, selfHosting] = DOCS_SECTIONS
    expect(forKitas.title).toBe('Für Kitas')
    expect(selfHosting.title).toBe('Selbst hosten')
    for (const id of forKitas.ids) expect(id).toStartWith('fuer-kitas/')
    for (const id of selfHosting.ids) expect(id).toStartWith('selbst-hosten/')
  })

  test('are all linked from the table of contents', () => {
    const index = docs.get('README.md')
    const linked = new Set(index?.links.map((url) => target(index, url).file))
    const missing = sectionIds.filter((id) => !linked.has(`${id}.md`))
    expect(missing).toEqual([])
  })

  // The same rule the site applies (src/lib/docs/doc-links.ts): a link to a
  // Markdown file in docs/ has to arrive at a page, not at a file that only
  // GitHub shows — like the two left at the old addresses
  test('link to each other with addresses the site serves', () => {
    const served = new Set(DOCS_ORDER.map(docsPath))
    const lost = pages.flatMap((doc) =>
      doc.links
        .filter((url) => !hasScheme(url) && !url.startsWith('#'))
        .filter((url) => {
          const { file } = target(doc, url)
          if (file.startsWith('..') || !file.endsWith('.md')) return false
          const address = rewriteDocLink(url, resolve(DOCS, doc.file), DOCS)
          return !served.has(address.split('#')[0])
        })
        .map((url) => `${doc.file}: ${url}`),
    )
    expect(lost).toEqual([])
  })
})

describe('the pages for Kitas', () => {
  // The interface says "Brett"; "board" is for code and addresses
  test('say Brett, never Board', () => {
    const slips = pages
      .filter(({ file }) => file.startsWith('fuer-kitas/'))
      .flatMap(({ file, prose }) =>
        prose
          .filter((text) => /\bBoards?\b/i.test(text))
          .map((text) => `${file}: ${text}`),
      )
    expect(slips).toEqual([])
  })
})
