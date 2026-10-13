import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'

import { version } from '../package.json'
import { REPOSITORY_URL } from '../scripts/instance-config.mjs'

import { instanceMode, sourceLink } from '@/lib/instance'
import {
  legalFooterLinks,
  legalHref,
  legalPageResponse,
  legalPages,
  legalSources,
  serveLegalPage,
  type LegalPage,
} from '@/lib/legal'

// What /impressum, /datenschutz, /agb and /avv answer with
// (src/lib/legal.ts): an address on the operator's website or the Markdown
// mounted into LEGAL_DIR — and, for the terms and the data processing
// agreement, nothing at all unless the instance is hosted.
const PAGES: LegalPage[] = ['impressum', 'datenschutz', 'agb', 'avv']
const original = {
  directory: legalSources.directory,
  urls: PAGES.map((page) => legalPages[page].url),
}

// A directory of its own per test: what a page rendered is kept per file
const directories: string[] = []

function legalDirectory(files: Partial<Record<LegalPage, string>> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kibo-legal-pages-'))
  directories.push(directory)
  for (const [page, markdown] of Object.entries(files)) {
    writeFileSync(join(directory, `${page}.md`), markdown)
  }
  legalSources.directory = directory
  return directory
}

let warn: ReturnType<typeof spyOn>

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  instanceMode.hosted = false
  legalSources.directory = original.directory
  PAGES.forEach((page, index) => {
    legalPages[page].url = original.urls[index]
  })
})

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('the titles', () => {
  test('every page has one', () => {
    expect(PAGES.map((page) => legalPages[page].title)).toEqual([
      'Impressum',
      'Datenschutzerklärung',
      'Allgemeine Geschäftsbedingungen',
      'Vertrag zur Auftragsverarbeitung',
    ])
  })
})

describe('legalPageResponse', () => {
  // The terms are asked for on the hosted instance; the last block asks
  // without
  beforeEach(() => {
    instanceMode.hosted = true
  })

  test('renders the Markdown file of each page', async () => {
    legalDirectory({
      impressum: '## Angaben\n\nKita Beispiel\nMusterweg 1',
      datenschutz: '## Verantwortlich',
      agb: '## § 1 Geltungsbereich',
      avv: '## § 1 Gegenstand',
    })
    expect(await legalPageResponse('impressum')).toEqual({
      // Addresses keep their lines
      content: '<h2>Angaben</h2>\n<p>Kita Beispiel<br>Musterweg 1</p>\n',
    })
    for (const [page, heading] of [
      ['datenschutz', 'Verantwortlich'],
      ['agb', '§ 1 Geltungsbereich'],
      ['avv', '§ 1 Gegenstand'],
    ] as const) {
      expect(await legalPageResponse(page)).toEqual({
        content: `<h2>${heading}</h2>\n`,
      })
    }
    expect(warn).not.toHaveBeenCalled()
  })

  // The templates carry their instructions in comments
  test('leaves the comments of the templates out', async () => {
    legalDirectory({
      agb: '<!-- Vorlage:\nbitte prüfen -->\n\n> **Entwurf**\n\n## § 1',
    })
    const page = await legalPageResponse('agb')
    expect(page && 'content' in page && page.content).toBe(
      '<blockquote>\n<p><strong>Entwurf</strong></p>\n</blockquote>\n<h2>§ 1</h2>\n',
    )
  })

  test('redirects to the address of the operator’s own page', async () => {
    legalDirectory({ agb: '## nicht gemeint' })
    legalPages.agb.url = 'https://kibo.example/agb'
    legalPages.impressum.url = 'https://kita.example/impressum'
    expect(await legalPageResponse('agb')).toEqual({
      redirect: 'https://kibo.example/agb',
    })
    expect(await legalPageResponse('impressum')).toEqual({
      redirect: 'https://kita.example/impressum',
    })
    // An empty address is none
    legalPages.agb.url = ''
    expect(await legalPageResponse('agb')).toEqual({
      content: '<h2>nicht gemeint</h2>\n',
    })
  })

  test('without a file the page has no content, and warns once', async () => {
    const directory = legalDirectory({ agb: '## § 1' })
    for (const page of ['impressum', 'avv'] as const) {
      expect(await legalPageResponse(page)).toEqual({ content: undefined })
      expect(await legalPageResponse(page)).toEqual({ content: undefined })
    }
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      `[legal] ${join(directory, 'impressum.md')} nicht lesbar, /impressum zeigt nur einen Hinweis:`,
    )
    // A file that turns up is served without a restart
    writeFileSync(join(directory, 'avv.md'), '## § 1 Gegenstand')
    expect(await legalPageResponse('avv')).toEqual({
      content: '<h2>§ 1 Gegenstand</h2>\n',
    })
  })
})

// What the four pages make of it (serveLegalPage, called by
// src/pages/agb.astro and its neighbours): a redirect, the page with 200, the
// page that says nothing is mounted with 404 — and, for an answer that is
// undefined, the page every unknown address gets
describe('the four pages', () => {
  // The part of Astro a page hands over, and what came of it
  async function answer(page: LegalPage) {
    const response = { status: 200, statusText: 'OK' }
    const astro = {
      response,
      redirect: (location: string, status: number) =>
        new Response(null, { status, headers: { location } }),
    } as Parameters<typeof serveLegalPage>[0]
    const legal = await serveLegalPage(astro, page)
    return legal instanceof Response
      ? { status: legal.status, location: legal.headers.get('location') }
      : { ...response, legal }
  }

  async function answers() {
    const found: Record<string, unknown> = {}
    for (const page of PAGES) found[page] = await answer(page)
    return found
  }

  const NOT_FOUND = { status: 404, statusText: 'Not Found' }

  test('without HOSTED, /agb and /avv are addresses that do not exist', async () => {
    legalDirectory({
      impressum: '## A',
      datenschutz: '## B',
      agb: '## C',
      avv: '## D',
    })
    legalPages.avv.url = 'https://kibo.example/avv'
    expect(await answers()).toEqual({
      impressum: {
        status: 200,
        statusText: 'OK',
        legal: { content: '<h2>A</h2>\n' },
      },
      datenschutz: {
        status: 200,
        statusText: 'OK',
        legal: { content: '<h2>B</h2>\n' },
      },
      // Neither the file nor the redirect: there is no such page
      agb: { ...NOT_FOUND, legal: undefined },
      avv: { ...NOT_FOUND, legal: undefined },
    })
  })

  test('with HOSTED, all four are served', async () => {
    instanceMode.hosted = true
    legalDirectory({ impressum: '## A', agb: '## C' })
    legalPages.avv.url = 'https://kibo.example/avv'
    const found = await answers()
    expect(found).toEqual({
      impressum: {
        status: 200,
        statusText: 'OK',
        legal: { content: '<h2>A</h2>\n' },
      },
      // Nothing mounted: the page that says so
      datenschutz: { ...NOT_FOUND, legal: { content: undefined } },
      agb: {
        status: 200,
        statusText: 'OK',
        legal: { content: '<h2>C</h2>\n' },
      },
      avv: { status: 302, location: 'https://kibo.example/avv' },
    })
    // … which is a page of its own, not the one of an unknown address
    expect(found.datenschutz).toHaveProperty('legal')
    expect((found.datenschutz as { legal: unknown }).legal).toBeDefined()
  })
})

describe('the footer', () => {
  test('links imprint and privacy policy, on the hosted instance the terms too', () => {
    const selfHosted = [
      { href: '/impressum', label: 'Impressum' },
      { href: '/datenschutz', label: 'Datenschutz' },
    ]
    expect(legalFooterLinks()).toEqual(selfHosted)
    instanceMode.hosted = true
    expect(legalFooterLinks()).toEqual([
      ...selfHosted,
      { href: '/agb', label: 'AGB' },
      { href: '/avv', label: 'AV-Vertrag' },
    ])
  })

  test('links straight to the operator’s own pages', () => {
    instanceMode.hosted = true
    legalPages.datenschutz.url = 'https://kibo.example/datenschutz'
    legalPages.agb.url = 'https://kibo.example/agb'
    expect(legalFooterLinks().map((link) => link.href)).toEqual([
      '/impressum',
      'https://kibo.example/datenschutz',
      'https://kibo.example/agb',
      '/avv',
    ])
    expect(legalHref('avv')).toBe('/avv')
  })

  // Kibo is AGPL: every instance says where its source is. SOURCE_URL is
  // empty in the tests, as it is wherever Kibo runs unchanged.
  test('links the source and names the version the build was made from', () => {
    expect(sourceLink.href).toBe(REPOSITORY_URL)
    expect(sourceLink.version).toBe(version)
    expect(sourceLink.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
