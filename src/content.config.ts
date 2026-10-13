import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

import { DOCS_ORDER, docsFile } from '@/lib/docs/navigation'

// The documentation under /docs is rendered straight from the repository's
// docs/ folder, so GitHub and the website read the same files. No schema and
// no frontmatter: a page's title is its first heading (src/lib/docs/titles.ts).
// Its pages are the ones the navigation lists; the two files left at the old
// addresses, docs/deployment.md and docs/spam-schutz.md, only point to the
// new pages and are not part of it.
const docs = defineCollection({
  loader: glob({ base: './docs', pattern: DOCS_ORDER.map(docsFile) }),
})

export const collections = { docs }
