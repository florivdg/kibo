// The documentation's table of contents, once: the sidebar shows the two
// sections in this order, and "previous"/"next" walk through the flattened
// list. The ids are the pages' paths in docs/ without the extension; their
// labels are the pages' own headings (docTitles in ./titles.ts), so a title is
// written in exactly one place. What is listed here is a page: the collection
// (src/content.config.ts) and the links between the pages (./doc-links.ts)
// read this list, and tests/docs-content.test.ts keeps it and the files in
// step.
//
// No imports: astro.config.mjs loads this file through ./doc-links.ts.
export interface DocsSection {
  title: string
  ids: readonly string[]
}

export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    title: 'Für Kitas',
    ids: [
      'fuer-kitas/erste-schritte',
      'fuer-kitas/bretter',
      'fuer-kitas/zettel',
      'fuer-kitas/meldungen',
      'fuer-kitas/benachrichtigungen',
      'fuer-kitas/team',
      'fuer-kitas/konto-und-sicherheit',
      'fuer-kitas/datenexport',
      'fuer-kitas/abo',
    ],
  },
  {
    title: 'Selbst hosten',
    ids: [
      'selbst-hosten/ueberblick',
      'selbst-hosten/voraussetzungen',
      'selbst-hosten/traefik',
      'selbst-hosten/einrichtung',
      'selbst-hosten/konfiguration',
      'selbst-hosten/datenexport',
      'selbst-hosten/smtp',
      'selbst-hosten/impressum-und-datenschutz',
      'selbst-hosten/rechtswidrige-inhalte',
      'selbst-hosten/updates',
      'selbst-hosten/sicherung',
      'selbst-hosten/betrieb',
      'selbst-hosten/lasttests',
      'selbst-hosten/sicherheit',
      'selbst-hosten/fehlersuche',
      'selbst-hosten/benachrichtigungen',
      'selbst-hosten/spam-schutz',
    ],
  },
]

// docs/README.md: the table of contents on GitHub, the start page under /docs
export const DOCS_INDEX_ID = 'readme'

// Reading order: the index first, then every page of every section
export const DOCS_ORDER: readonly string[] = [
  DOCS_INDEX_ID,
  ...DOCS_SECTIONS.flatMap((section) => section.ids),
]

export function docsPath(id: string) {
  return id === DOCS_INDEX_ID ? '/docs' : `/docs/${id}`
}

// The file a page is written in, below docs/
export function docsFile(id: string) {
  return id === DOCS_INDEX_ID ? 'README.md' : `${id}.md`
}

// A page as a link: its address, and its own heading to read
export function docLink(id: string, titles: ReadonlyMap<string, string>) {
  return { href: docsPath(id), title: titles.get(id) ?? id }
}
