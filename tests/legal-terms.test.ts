import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { eq, inArray } from 'drizzle-orm'

import { legalTermsVersion } from '@/db/schema'
import { dateAndTime } from '@/lib/board/time'
import {
  sendTermsConfirmation,
  serveTermsVersion,
  storeTermsVersion,
  termsMails,
  termsVersionResponse,
} from '@/lib/hosted/terms'
import { hostedContact, instanceMode, operatorDetails } from '@/lib/instance'
import {
  legalPages,
  legalSources,
  termsLinks,
  type TermsPage,
} from '@/lib/legal'
import type { Mail } from '@/lib/mail/mailer'

import { testDb } from './helpers/spam-db'

// The versions of the terms and the data processing agreement
// (src/lib/hosted/terms.ts): stored when the server first runs with a
// HOSTED_TERMS_VERSION, refused when the files read differently under a
// version that is stored, served for good at /agb/<version> and
// /avv/<version>, linked by the box an account ticks, and confirmed to the
// account by mail.
const original = {
  directory: legalSources.directory,
  agbUrl: legalPages.agb.url,
  avvUrl: legalPages.avv.url,
  operator: { ...operatorDetails },
}

const directories: string[] = []
const versions: string[] = []

function legalDirectory(files: Partial<Record<TermsPage, string>>) {
  const directory = mkdtempSync(join(tmpdir(), 'kibo-legal-terms-'))
  directories.push(directory)
  for (const [page, markdown] of Object.entries(files)) {
    writeFileSync(join(directory, `${page}.md`), markdown)
  }
  legalSources.directory = directory
  return directory
}

// A version of this test's own, which the database has never seen
function newVersion() {
  const version = `test-${randomUUID().slice(0, 8)}`
  versions.push(version)
  hostedContact.termsVersion = version
  return version
}

async function storedVersion(version: string) {
  const [row] = await testDb
    .select({ agb: legalTermsVersion.agb, avv: legalTermsVersion.avv })
    .from(legalTermsVersion)
    .where(eq(legalTermsVersion.version, version))
  return row
}

async function refusal(run: Promise<unknown>) {
  try {
    await run
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

let info: ReturnType<typeof spyOn>
let warn: ReturnType<typeof spyOn>

beforeEach(() => {
  instanceMode.hosted = true
  info = spyOn(console, 'info').mockImplementation(() => {})
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  info.mockRestore()
  warn.mockRestore()
  instanceMode.hosted = false
  hostedContact.termsVersion = '2026-10'
  legalSources.directory = original.directory
  legalPages.agb.url = original.agbUrl
  legalPages.avv.url = original.avvUrl
  Object.assign(operatorDetails, original.operator)
})

afterAll(async () => {
  await testDb
    .delete(legalTermsVersion)
    .where(inArray(legalTermsVersion.version, versions))
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('the start of the server', () => {
  test('stores a new version with what agb.md and avv.md publish', async () => {
    legalDirectory({
      agb: '<!-- Hinweis für den Betreiber -->\n\n## § 1 Geltungsbereich\n',
      avv: '## § 1 Gegenstand',
    })
    const version = newVersion()

    expect(await storeTermsVersion(testDb)).toBe(true)
    // The comments of the templates are not part of the text
    expect(await storedVersion(version)).toEqual({
      agb: '## § 1 Geltungsbereich',
      avv: '## § 1 Gegenstand',
    })
    expect(info).toHaveBeenCalledWith(
      `[legal] AGB und AV-Vertrag als Fassung "${version}" gespeichert`,
    )

    // Started again — or by a second process — there is nothing to store
    expect(await storeTermsVersion(testDb)).toBe(false)
  })

  test('a comment that changes is no new text', async () => {
    const directory = legalDirectory({ agb: '## § 1', avv: '## § 1' })
    newVersion()
    await storeTermsVersion(testDb)
    writeFileSync(join(directory, 'agb.md'), '<!-- neu -->\n## § 1\n\n')
    expect(await storeTermsVersion(testDb)).toBe(false)
  })

  // Nothing the rendered page shows: a hint taken out between two
  // paragraphs leaves its blank lines behind, an editor on Windows writes
  // other line endings, and blanks at the end of a line are invisible
  test('blank lines, line endings and trailing blanks are no new text', async () => {
    const stored = '## § 1\n\nErster Absatz.\n\nZweiter Absatz.'
    const directory = legalDirectory({ agb: stored, avv: stored })
    const version = newVersion()
    await storeTermsVersion(testDb)

    for (const markdown of [
      '## § 1\n\nErster Absatz.\n\n<!-- Hinweis -->\n\nZweiter Absatz.',
      '## § 1\n\n<!--\nmehrzeiliger\nHinweis\n-->\n\nErster Absatz.\n\nZweiter Absatz.\n',
      '## § 1\r\n\r\nErster Absatz.\r\n\r\nZweiter Absatz.\r\n',
      '## § 1  \n\t\nErster Absatz. \n\n\n\nZweiter Absatz.\t',
    ]) {
      writeFileSync(join(directory, 'agb.md'), markdown)
      expect(await storeTermsVersion(testDb)).toBe(false)
    }
    expect((await storedVersion(version))?.agb).toBe(stored)

    // A word is
    writeFileSync(
      join(directory, 'agb.md'),
      '## § 1\r\n\r\nErster Absatz.\r\n\r\nDritter Absatz.\r\n',
    )
    expect(await refusal(storeTermsVersion(testDb))).toContain(
      'Text von agb.md gespeichert',
    )
  })

  test('refuses a text that differs from the one stored under the version', async () => {
    const directory = legalDirectory({ agb: '## § 1', avv: '## § 1' })
    const version = newVersion()
    await storeTermsVersion(testDb)

    writeFileSync(join(directory, 'agb.md'), '## § 1 (geändert)')
    expect(await refusal(storeTermsVersion(testDb))).toBe(
      `HOSTED_TERMS_VERSION "${version}" ist bereits mit einem anderen Text von agb.md gespeichert. Wer AGB oder AV-Vertrag ändert, setzt eine neue HOSTED_TERMS_VERSION – jede Fassung, der ein Konto zugestimmt hat, muss unverändert abrufbar bleiben.`,
    )
    writeFileSync(join(directory, 'avv.md'), '## § 1 (geändert)')
    expect(await refusal(storeTermsVersion(testDb))).toContain(
      'Text von agb.md und avv.md gespeichert',
    )
    // What was agreed to stays as it was
    expect(await storedVersion(version)).toEqual({
      agb: '## § 1',
      avv: '## § 1',
    })

    // A new version takes the new texts
    const next = newVersion()
    expect(await storeTermsVersion(testDb)).toBe(true)
    expect(await storedVersion(next)).toEqual({
      agb: '## § 1 (geändert)',
      avv: '## § 1 (geändert)',
    })
  })

  // The operator's own page is theirs to archive
  test('keeps nothing of a document published under its address', async () => {
    legalDirectory({ agb: '## nicht gemeint', avv: '## § 1' })
    legalPages.agb.url = 'https://kibo.example/agb'
    const version = newVersion()
    expect(await storeTermsVersion(testDb)).toBe(true)
    expect(await storedVersion(version)).toEqual({ agb: null, avv: '## § 1' })

    // … and a file that takes its place under the same version is a change
    legalPages.agb.url = ''
    expect(await refusal(storeTermsVersion(testDb))).toContain(
      'Text von agb.md gespeichert',
    )
  })

  // Only the dev server gets this far without them (scripts/server.mjs)
  test('stores nothing while a document is missing', async () => {
    legalDirectory({ agb: '## § 1' })
    const version = newVersion()
    expect(await storeTermsVersion(testDb)).toBe(false)
    expect(await storedVersion(version)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('names the version when the texts cannot be checked', async () => {
    const directory = legalDirectory({ avv: '## § 1' })
    // A directory where the file should be: not missing, but unreadable
    mkdirSync(join(directory, 'agb.md'))
    const version = newVersion()
    expect(await refusal(storeTermsVersion(testDb))).toStartWith(
      `AGB und AV-Vertrag der HOSTED_TERMS_VERSION "${version}" nicht prüfbar:`,
    )
  })

  test('without HOSTED nothing is read or stored', async () => {
    instanceMode.hosted = false
    legalDirectory({ agb: '## § 1', avv: '## § 1' })
    const version = newVersion()
    expect(await storeTermsVersion(testDb)).toBe(false)
    expect(await storedVersion(version)).toBeUndefined()
  })
})

describe('/agb/<version> and /avv/<version>', () => {
  // The part of Astro a page hands over, and what came of it
  async function answer(page: TermsPage, version: string) {
    const response = { status: 200, statusText: 'OK' }
    const astro = {
      response,
      redirect: (location: string, status: number) =>
        new Response(null, { status, headers: { location } }),
    } as Parameters<typeof serveTermsVersion>[0]
    const legal = await serveTermsVersion(astro, page, version)
    return legal instanceof Response
      ? { status: legal.status, location: legal.headers.get('location') }
      : { ...response, legal }
  }

  const NOT_FOUND = { status: 404, statusText: 'Not Found', legal: undefined }

  test('serve the text stored under the version, whatever the files say now', async () => {
    const directory = legalDirectory({ agb: '## Alt', avv: '## AV alt' })
    const old = newVersion()
    await storeTermsVersion(testDb)
    writeFileSync(join(directory, 'agb.md'), '## Neu')
    const current = newVersion()
    await storeTermsVersion(testDb)

    expect(await answer('agb', old)).toEqual({
      status: 200,
      statusText: 'OK',
      legal: { content: '<h2>Alt</h2>\n' },
    })
    expect(await answer('avv', old)).toEqual({
      status: 200,
      statusText: 'OK',
      legal: { content: '<h2>AV alt</h2>\n' },
    })
    expect(await answer('agb', current)).toEqual({
      status: 200,
      statusText: 'OK',
      legal: { content: '<h2>Neu</h2>\n' },
    })
  })

  test('an unknown version is an address that does not exist', async () => {
    legalDirectory({ agb: '## § 1', avv: '## § 1' })
    newVersion()
    await storeTermsVersion(testDb)
    for (const version of ['1999-01', '../agb', 'a b', '']) {
      expect(await answer('agb', version)).toEqual(NOT_FOUND)
    }
  })

  test('the current version under the operator’s address leads there', async () => {
    legalDirectory({ avv: '## § 1' })
    legalPages.agb.url = 'https://kibo.example/agb'
    const version = newVersion()
    await storeTermsVersion(testDb)
    expect(await answer('agb', version)).toEqual({
      status: 302,
      location: 'https://kibo.example/agb',
    })
  })

  test('without HOSTED neither exists', async () => {
    legalDirectory({ agb: '## § 1', avv: '## § 1' })
    const version = newVersion()
    await storeTermsVersion(testDb)
    instanceMode.hosted = false
    expect(await termsVersionResponse('agb', version)).toBeUndefined()
    expect(await answer('avv', version)).toEqual(NOT_FOUND)
  })
})

describe('the box for the terms', () => {
  test('links the version it agrees to, and names it', () => {
    hostedContact.termsVersion = '2027-01'
    expect(termsLinks()).toEqual({
      agbHref: '/agb/2027-01',
      avvHref: '/avv/2027-01',
      version: '2027-01',
    })
  })

  test('links the operator’s own page where there is one', () => {
    legalPages.avv.url = 'https://kibo.example/avv'
    expect(termsLinks()).toEqual({
      agbHref: '/agb/2026-10',
      avvHref: 'https://kibo.example/avv',
      version: '2026-10',
    })
  })
})

describe('the mail that confirms an agreement', () => {
  let sent: Mail[] = []
  const realSend = termsMails.send

  beforeEach(() => {
    sent = []
    termsMails.send = async (mail) => {
      sent.push(mail)
    }
    operatorDetails.name = 'Kibo Betrieb GmbH'
    operatorDetails.address = ['Musterweg 1', '12345 Musterstadt']
  })

  afterEach(() => {
    termsMails.send = realSend
  })

  test('names the parties, the version and the moment, and links both texts', async () => {
    const email = `terms-${randomUUID()}@kita.example`
    const acceptedAt = new Date('2026-10-05T12:34:00.000Z')
    await sendTermsConfirmation({
      account: { name: 'Anna Beispiel', email },
      party: { label: 'Kita', value: 'Kita Sonnenschein' },
      terms: { termsVersion: '2026-10', termsAcceptedAt: acceptedAt },
    })

    expect(sent).toHaveLength(1)
    const [mail] = sent
    expect(mail!.to).toBe(email)
    expect(mail!.text).toContain(
      [
        'Anbieter:\n  Kibo Betrieb GmbH\n  Musterweg 1\n  12345 Musterstadt',
        `Konto: Anna Beispiel (${email})`,
        'Kita: Kita Sonnenschein',
        'Fassung: 2026-10',
        `Zugestimmt am: ${dateAndTime(acceptedAt)} Uhr (deutsche Zeit)`,
        'AGB: http://localhost:4321/agb/2026-10',
        'AV-Vertrag: http://localhost:4321/avv/2026-10',
      ].join('\n'),
    )
    // In Berlin, summer time
    expect(dateAndTime(acceptedAt)).toBe('05.10.2026, 14:34')
    // Both texts as links, then the footer every mail has
    expect(mail!.html).toContain(
      '<a href="http://localhost:4321/agb/2026-10" style="color:#18181b;word-break:break-all">http://localhost:4321/agb/2026-10</a>',
    )
    expect(mail!.text).toContain('Impressum: http://localhost:4321/impressum')
  })

  test('links the operator’s own page of a document published there', async () => {
    legalPages.agb.url = 'https://kibo.example/agb'
    await sendTermsConfirmation({
      account: { name: 'Anna', email: `terms-${randomUUID()}@kita.example` },
      party: { label: 'Kita', value: 'Kita Regenbogen' },
      terms: { termsVersion: '2026-10', termsAcceptedAt: new Date() },
    })
    expect(sent[0]!.text).toContain('AGB: https://kibo.example/agb\n')
  })

  test('counts against the invoice mail budgets of the address', async () => {
    const email = `terms-${randomUUID()}@kita.example`
    const confirm = () =>
      sendTermsConfirmation({
        account: { name: 'Anna', email },
        party: { label: 'Kita', value: 'Kita Sonnenschein' },
        terms: { termsVersion: '2026-10', termsAcceptedAt: new Date() },
      })
    // Three per hour from one network (MAIL_BUDGETS in src/lib/spam/budgets.ts)
    for (let i = 0; i < 4; i++) await confirm()
    expect(sent).toHaveLength(3)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
