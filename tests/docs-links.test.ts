import { describe, expect, test } from 'bun:test'

import { rewriteDocLink } from '@/lib/docs/doc-links'

const DOCS = '/repo/docs'
const GITHUB = 'https://github.com/florivdg/kibo'

// A link as written in one of the pages, and what it becomes on the website
const from = (file: string) => (url: string) =>
  rewriteDocLink(url, `${DOCS}/${file}`, DOCS)

describe('rewriteDocLink', () => {
  const inKitas = from('fuer-kitas/zettel.md')
  const inHosting = from('selbst-hosten/updates.md')
  const inIndex = from('README.md')

  test('turns a link to another page into its address under /docs', () => {
    expect(inKitas('./bretter.md')).toBe('/docs/fuer-kitas/bretter')
    expect(inKitas('bretter.md')).toBe('/docs/fuer-kitas/bretter')
    expect(inKitas('../selbst-hosten/spam-schutz.md')).toBe(
      '/docs/selbst-hosten/spam-schutz',
    )
    expect(inIndex('./fuer-kitas/erste-schritte.md')).toBe(
      '/docs/fuer-kitas/erste-schritte',
    )
  })

  test('keeps the anchor, umlauts included', () => {
    expect(inKitas('./bretter.md#brett-arten')).toBe(
      '/docs/fuer-kitas/bretter#brett-arten',
    )
    expect(inHosting('./einrichtung.md#startprüfung')).toBe(
      '/docs/selbst-hosten/einrichtung#startprüfung',
    )
  })

  test('sends the table of contents to /docs itself', () => {
    expect(inKitas('../README.md')).toBe('/docs')
    expect(inHosting('../README.md#selbst-hosten')).toBe('/docs#selbst-hosten')
  })

  test('sends everything else in the repository to GitHub', () => {
    expect(inHosting('../../CHANGELOG.md')).toBe(
      `${GITHUB}/blob/main/CHANGELOG.md`,
    )
    expect(inIndex('../README.md')).toBe(`${GITHUB}/blob/main/README.md`)
    expect(inIndex('./kibo-infoblatt.pdf')).toBe(
      `${GITHUB}/blob/main/docs/kibo-infoblatt.pdf`,
    )
    expect(
      inHosting('../../deploy/legal/datenschutz.md#benachrichtigungen'),
    ).toBe(`${GITHUB}/blob/main/deploy/legal/datenschutz.md#benachrichtigungen`)
    // A directory has no extension
    expect(inHosting('../../deploy')).toBe(`${GITHUB}/tree/main/deploy`)
    expect(inHosting('../../deploy/')).toBe(`${GITHUB}/tree/main/deploy`)
  })

  // The files left at the old addresses are no pages of the website
  test('reads a Markdown file outside the two sections on GitHub', () => {
    expect(inIndex('./deployment.md')).toBe(
      `${GITHUB}/blob/main/docs/deployment.md`,
    )
    expect(inKitas('../fuer-kitas/entwurf/notiz.md')).toBe(
      `${GITHUB}/blob/main/docs/fuer-kitas/entwurf/notiz.md`,
    )
  })

  test('leaves alone what is no relative path', () => {
    for (const url of [
      '#laufzeit',
      'https://webkit.org/blog/16535/meet-declarative-web-push/',
      'http://localhost:8025',
      'mailto:betrieb@example.org',
      'tel:+4930123456',
      '/impressum',
      '//example.org/x',
      '?seite=2',
      '',
    ]) {
      expect(inKitas(url)).toBe(url)
    }
  })

  test('leaves alone what points out of the repository', () => {
    expect(inKitas('../../../etc/passwd')).toBe('../../../etc/passwd')
    expect(inIndex('../..')).toBe('../..')
  })

  // The plugin runs for every Markdown file Astro renders
  test('does nothing in a file outside docs/', () => {
    expect(
      rewriteDocLink('./bretter.md', '/repo/legal/impressum.md', DOCS),
    ).toBe('./bretter.md')
    expect(rewriteDocLink('./x.md', '/repo/docs-alt/seite.md', DOCS)).toBe(
      './x.md',
    )
  })
})
