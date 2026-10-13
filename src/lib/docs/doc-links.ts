import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineMdastPlugin } from 'satteri'

import { REPOSITORY_URL } from '../../../scripts/instance-config.mjs'
import { DOCS_ORDER, docsFile, docsPath } from './navigation.ts'

// The pages in docs/ link to each other the way GitHub reads them: relative
// paths to the Markdown files (`./zettel.md#laufzeit`, `../../deploy`). That
// is the one way of writing a link that works in the repository, and this
// module turns it into the address the same target has on the website.
//
// Imported by astro.config.mjs, so nothing here may use the @/ alias or
// anything that only exists inside Astro's build.

// The pages of the documentation, by their file below docs/
const PAGES = new Map(DOCS_ORDER.map((id) => [docsFile(id), docsPath(id)]))

// `mailto:`, `https:` and the like
export function hasScheme(url: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(url)
}

function isRelative(url: string) {
  return url !== '' && !/^[#/?]/.test(url) && !hasScheme(url)
}

// Path and the rest (`?query`, `#anchor`), which travels along unchanged
function splitSuffix(url: string): [path: string, suffix: string] {
  const at = url.search(/[?#]/)
  return at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at)]
}

function isInside(path: string) {
  return path !== '' && !path.startsWith('..')
}

const posix = (path: string) => path.split(sep).join('/')

// Anything else in the repository is read on GitHub: a file as a blob, a
// directory as a tree
function repositoryUrl(inRepo: string) {
  const kind = extname(inRepo) ? 'blob' : 'tree'
  return `${REPOSITORY_URL}/${kind}/main/${inRepo}`
}

/**
 * The address a link in a documentation page gets on the website.
 *
 * Absolute addresses, `mailto:`, anchors on the same page and links in files
 * outside `docsDir` stay as they are. A relative link to another page becomes
 * that page's address under /docs, one to anything else in the repository its
 * address on GitHub.
 *
 * @param url as written in the Markdown file
 * @param fromFile absolute path of that file
 * @param docsDir absolute path of the repository's `docs` directory
 */
export function rewriteDocLink(url: string, fromFile: string, docsDir: string) {
  if (!isRelative(url) || !isInside(relative(docsDir, fromFile))) return url
  const [path, suffix] = splitSuffix(url)
  const target = resolve(dirname(fromFile), decodeURI(path))
  const page = PAGES.get(posix(relative(docsDir, target)))
  if (page) return `${page}${suffix}`
  const inRepo = relative(dirname(docsDir), target)
  return isInside(inRepo) ? `${repositoryUrl(posix(inRepo))}${suffix}` : url
}

/**
 * The Sätteri plugin that applies the rule above to every link of a page.
 * Images are left alone: Astro resolves `../screenshots/x.webp` itself.
 *
 * @param docsDir defaults to `docs` in the directory Astro runs in
 */
export function docLinks(docsDir = resolve('docs')) {
  const rewrite = (url: string, fileURL: URL | undefined) =>
    fileURL ? rewriteDocLink(url, fileURLToPath(fileURL), docsDir) : url
  return defineMdastPlugin({
    name: 'kibo-doc-links',
    link(node, ctx) {
      const url = rewrite(node.url, ctx.fileURL)
      if (url !== node.url) ctx.setProperty(node, 'url', url)
    },
    // `[text][ref]` with `[ref]: ./page.md` further down
    definition(node, ctx) {
      const url = rewrite(node.url, ctx.fileURL)
      if (url !== node.url) ctx.setProperty(node, 'url', url)
    },
  })
}
