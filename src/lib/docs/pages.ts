import { DOCS_INDEX_ID, DOCS_ORDER } from '@/lib/docs/navigation'

// The pages carry no frontmatter — GitHub would show it as a table above the
// text — so what a page is called and what it is about is read from its
// Markdown: the one `# ` heading (./titles.ts), and the first paragraph after
// it.

// Inline markup a summary may carry, reduced to its text
function plainText(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// A block that is text: no heading, list, table, image, code or quote
function isParagraph(block: string) {
  return !/^(?:#|[-*+] |\d+\. |\||!\[|```|>|<)/.test(block)
}

// The first paragraph, for the page's description
export function docSummary(body: string) {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && isParagraph(block))
  return paragraph ? plainText(paragraph) : undefined
}

/**
 * Which page a request under /docs means.
 *
 * @param slug the rest of the path, undefined for /docs itself
 * @returns the id to render, or undefined for an address that is no page —
 *   the index is reachable as /docs only, not under its own id
 */
export function resolveDocPage(slug: string | undefined) {
  const id = slug ?? DOCS_INDEX_ID
  return slug !== DOCS_INDEX_ID && DOCS_ORDER.includes(id) ? id : undefined
}

// The pages before and after one in reading order; a page outside the
// navigation has neither
export function neighbours(id: string): {
  previous: string | undefined
  next: string | undefined
} {
  const at = DOCS_ORDER.indexOf(id)
  if (at === -1) return { previous: undefined, next: undefined }
  // Past either end there is nothing, which an index says and `at()` doesn't
  return { previous: DOCS_ORDER[at - 1], next: DOCS_ORDER[at + 1] }
}
