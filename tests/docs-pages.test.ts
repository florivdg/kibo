import { afterEach, describe, expect, test } from 'bun:test'

import {
  DOCS_INDEX_ID,
  DOCS_ORDER,
  DOCS_SECTIONS,
  docLink,
  docsFile,
  docsPath,
} from '@/lib/docs/navigation'
import { docSummary, neighbours, resolveDocPage } from '@/lib/docs/pages'
import { docsHref, instanceMode } from '@/lib/instance'

import { DEFAULT_DOCS_URL } from '../scripts/instance-config.mjs'

const [forKitas, selfHosting] = DOCS_SECTIONS

describe('resolveDocPage', () => {
  test('reads /docs itself as the index', () => {
    expect(resolveDocPage(undefined)).toBe(DOCS_INDEX_ID)
  })

  test('takes the path of a page', () => {
    expect(resolveDocPage('fuer-kitas/zettel')).toBe('fuer-kitas/zettel')
    expect(resolveDocPage('selbst-hosten/updates')).toBe(
      'selbst-hosten/updates',
    )
  })

  // One address per page: the index is /docs, not /docs/readme
  test('knows nothing else, not even the index by its id', () => {
    for (const slug of [
      DOCS_INDEX_ID,
      'README',
      'fuer-kitas',
      'fuer-kitas/zettel.md',
      'Fuer-Kitas/Zettel',
      'deployment',
      '',
    ]) {
      expect(resolveDocPage(slug)).toBeUndefined()
    }
  })
})

describe('neighbours', () => {
  test('leads from the index to the first page and back', () => {
    const first = forKitas.ids[0]
    expect(neighbours(DOCS_INDEX_ID)).toEqual({
      previous: undefined,
      next: first,
    })
    expect(neighbours(first).previous).toBe(DOCS_INDEX_ID)
  })

  test('crosses from one section into the next', () => {
    const last = forKitas.ids.at(-1) ?? ''
    const first = selfHosting.ids[0]
    expect(neighbours(last).next).toBe(first)
    expect(neighbours(first).previous).toBe(last)
  })

  test('ends with the last page', () => {
    const last = DOCS_ORDER.at(-1) ?? ''
    expect(neighbours(last).next).toBeUndefined()
    expect(neighbours(last).previous).toBe(DOCS_ORDER.at(-2))
  })

  test('has nothing for a page outside the navigation', () => {
    expect(neighbours('fuer-kitas/gibt-es-nicht')).toEqual({
      previous: undefined,
      next: undefined,
    })
  })
})

describe('docsPath and docsFile', () => {
  test('are /docs and README.md for the index', () => {
    expect(docsPath(DOCS_INDEX_ID)).toBe('/docs')
    expect(docsFile(DOCS_INDEX_ID)).toBe('README.md')
  })

  test('are the id below /docs and the Markdown file for a page', () => {
    expect(docsPath('fuer-kitas/zettel')).toBe('/docs/fuer-kitas/zettel')
    expect(docsFile('fuer-kitas/zettel')).toBe('fuer-kitas/zettel.md')
  })
})

describe('docLink', () => {
  const titles = new Map([['fuer-kitas/zettel', 'Zettel']])

  test("is a page's address and its heading", () => {
    expect(docLink('fuer-kitas/zettel', titles)).toEqual({
      href: '/docs/fuer-kitas/zettel',
      title: 'Zettel',
    })
  })

  test('falls back to the id for a page without a heading', () => {
    expect(docLink('fuer-kitas/team', titles).title).toBe('fuer-kitas/team')
  })
})

describe('docSummary', () => {
  const body = [
    '# Bretter `anlegen` und **teilen**',
    '',
    '![Ein Brett im Admin-Bereich](../screenshots/admin-board.webp)',
    '',
    'Eine Kita kann beliebig viele [Bretter](./bretter.md) haben,',
    'zum Beispiel eine _Fundkiste_.',
    '',
    '## Brett-Arten',
    '',
    'Zweiter Absatz.',
  ].join('\n')

  test('reads the first paragraph, as one line of text', () => {
    expect(docSummary(body)).toBe(
      'Eine Kita kann beliebig viele Bretter haben, zum Beispiel eine Fundkiste.',
    )
  })

  test('skips what is no paragraph', () => {
    expect(
      docSummary('# Titel\n\n- eins\n- zwei\n\n| a | b |\n\n```sh\nls\n```'),
    ).toBeUndefined()
    expect(docSummary('# Titel\n\n1. eins\n\n> Zitat\n\nDann Text.')).toBe(
      'Dann Text.',
    )
  })
})

describe('docsHref', () => {
  const { hosted } = instanceMode
  afterEach(() => {
    instanceMode.hosted = hosted
  })

  // The test environment sets neither HOSTED nor DOCS_URL
  test('is the documentation on GitHub on a self-hosted instance', () => {
    instanceMode.hosted = false
    expect(docsHref()).toBe(DEFAULT_DOCS_URL)
  })

  test("is the instance's own /docs when it serves them", () => {
    instanceMode.hosted = true
    expect(docsHref()).toBe('/docs')
  })
})
