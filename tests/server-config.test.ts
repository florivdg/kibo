import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

import {
  configurationProblems,
  hostedLegalProblems,
} from '../scripts/server.mjs'

import { withSecurityHeaders } from '@/lib/server/security-headers'

import { RFC8291_SERVER_KEYS } from './helpers/rfc8291-keys'

const valid = {
  DATABASE_URL: 'postgresql://kibo:secret@db:5432/kibo',
  BETTER_AUTH_URL: 'https://kibo.example',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  TRUSTED_PROXIES: '',
  SIGNUP_MODE: 'open',
  SIGNUP_EMAIL_DOMAINS: '',
  HOSTED: '',
  DOCS_URL: '',
}

const problems = (env: Record<string, string | undefined>): string[] =>
  configurationProblems(env)

describe('configurationProblems', () => {
  test('lets a complete configuration start', () => {
    expect(problems(valid)).toEqual([])
    // A local test run over plain HTTP
    for (const url of [
      'http://localhost:4413',
      'http://127.0.0.1:4321',
      'http://[::1]:4321',
    ]) {
      expect(problems({ ...valid, BETTER_AUTH_URL: url })).toEqual([])
    }
  })

  test('names every missing or empty variable', () => {
    expect(
      problems({ ...valid, DATABASE_URL: ' ', BETTER_AUTH_SECRET: undefined }),
    ).toEqual(['DATABASE_URL fehlt', 'BETTER_AUTH_SECRET fehlt'])
  })

  test('refuses a short secret and a public address without HTTPS', () => {
    expect(problems({ ...valid, BETTER_AUTH_SECRET: 'kurz' })).toHaveLength(1)
    expect(
      problems({ ...valid, BETTER_AUTH_URL: 'http://kibo.example' }),
    ).toHaveLength(1)
    expect(
      problems({ ...valid, BETTER_AUTH_URL: 'kibo.example' }),
    ).toHaveLength(1)
  })

  test('checks every TRUSTED_PROXIES entry', () => {
    const good = '10.0.0.0/8, 192.0.2.1 ,2001:db8::/32'
    expect(problems({ ...valid, TRUSTED_PROXIES: good })).toEqual([])
    for (const bad of [
      '10.0.0.0/33',
      'proxy.local',
      '10.0.0.0/8/1',
      '::1/129',
    ]) {
      expect(problems({ ...valid, TRUSTED_PROXIES: `${good},${bad}` })).toEqual(
        [`TRUSTED_PROXIES enthält ungültige Einträge: ${bad}`],
      )
    }
  })
})

describe('sign-up configuration', () => {
  test('starts open, closed or with neither variable set', () => {
    expect(problems({ ...valid, SIGNUP_MODE: 'closed' })).toEqual([])
    expect(
      problems({
        ...valid,
        SIGNUP_MODE: undefined,
        SIGNUP_EMAIL_DOMAINS: undefined,
      }),
    ).toEqual([])
  })

  // A typo must not leave a sign-up open that was meant to be closed
  test('refuses a mode it does not know and names the value', () => {
    expect(problems({ ...valid, SIGNUP_MODE: 'geschlossen' })).toEqual([
      'SIGNUP_MODE muss open oder closed sein: "geschlossen"',
    ])
    expect(problems({ ...valid, SIGNUP_MODE: 'Closed' })).toHaveLength(1)
  })

  test('checks every SIGNUP_EMAIL_DOMAINS entry', () => {
    const good = 'kita-verbund.de, *.kita-verbund.de ,Träger.example'
    expect(problems({ ...valid, SIGNUP_EMAIL_DOMAINS: good })).toEqual([])
    for (const bad of ['*', '*.de', 'kita.de:25', '@kita.de', '10.0.0.1']) {
      expect(
        problems({ ...valid, SIGNUP_EMAIL_DOMAINS: `${good},${bad}` }),
      ).toEqual([`SIGNUP_EMAIL_DOMAINS enthält ungültige Einträge: ${bad}`])
    }
  })

  test('reports both when both are wrong', () => {
    expect(
      problems({
        ...valid,
        SIGNUP_MODE: 'zu',
        SIGNUP_EMAIL_DOMAINS: 'kita.de, *',
      }),
    ).toEqual([
      'SIGNUP_MODE muss open oder closed sein: "zu"',
      'SIGNUP_EMAIL_DOMAINS enthält ungültige Einträge: *',
    ])
  })
})

// Everything the hosted instance can't run without
const hosted = {
  ...valid,
  HOSTED: 'true',
  SMTP_HOST: 'smtp.kibo.example',
  HOSTED_TERMS_VERSION: '2026-10',
  HOSTED_OPERATOR_EMAIL: 'betrieb@kibo.example',
  OPERATOR_NAME: 'Kibo Betrieb GmbH',
  OPERATOR_ADDRESS: 'Musterstraße 1 | 12345 Musterstadt',
  OPERATOR_EMAIL: 'kontakt@kibo.example',
  IMPRESSUM_URL: 'https://kibo.example/impressum',
  DATENSCHUTZ_URL: 'https://kibo.example/datenschutz',
  AGB_URL: 'https://kibo.example/agb',
  AVV_URL: 'https://kibo.example/avv',
}

describe('hosted configuration', () => {
  test('starts hosted, self-hosted or with neither variable set', () => {
    expect(problems(hosted)).toEqual([])
    expect(
      problems({
        ...valid,
        HOSTED: 'false',
        DOCS_URL: 'https://kita-verbund.de/kibo/hilfe',
      }),
    ).toEqual([])
    expect(
      problems({ ...valid, HOSTED: undefined, DOCS_URL: undefined }),
    ).toEqual([])
  })

  test('refuses a HOSTED that is neither true nor false', () => {
    expect(problems({ ...valid, HOSTED: 'yes' })).toEqual([
      'HOSTED muss true oder false sein: "yes"',
    ])
    expect(problems({ ...valid, HOSTED: 'TRUE' })).toHaveLength(1)
  })

  // Reminders and invoices go out by mail
  test('hosted needs a mail server, self-hosted does not', () => {
    const SMTP =
      'HOSTED=true braucht SMTP_HOST (Erinnerungen und Rechnungen gehen per Mail)'
    expect(problems({ ...hosted, SMTP_HOST: undefined })).toEqual([SMTP])
    expect(problems({ ...hosted, SMTP_HOST: '  ' })).toEqual([SMTP])
    expect(problems({ ...hosted, HOSTED: ' true ', SMTP_HOST: '' })).toEqual([
      SMTP,
    ])
    for (const HOSTED of ['false', '', undefined]) {
      expect(problems({ ...valid, HOSTED })).toEqual([])
    }
  })

  test('takes the prices and the trial as whole numbers', () => {
    expect(
      problems({
        ...hosted,
        HOSTED_PRICE_EUR: '59',
        HOSTED_INCLUDED_KITAS: '0',
        HOSTED_EXTRA_KITA_EUR: '0',
        HOSTED_TRIAL_DAYS: '14',
      }),
    ).toEqual([])
    expect(
      problems({ ...hosted, HOSTED_PRICE_EUR: '', HOSTED_TRIAL_DAYS: ' ' }),
    ).toEqual([])
  })

  // A typo must not quietly mean "free" or "no trial" — hosted or not
  test('names exactly the numbers it cannot parse', () => {
    expect(
      problems({ ...hosted, HOSTED_TRIAL_DAYS: '0', HOSTED_PRICE_EUR: 'abc' }),
    ).toEqual([
      'HOSTED_PRICE_EUR muss eine ganze Zahl ab 0 sein: "abc"',
      'HOSTED_TRIAL_DAYS muss eine ganze Zahl ab 1 sein: "0"',
    ])
    expect(problems({ ...valid, HOSTED_EXTRA_KITA_EUR: '9,50' })).toEqual([
      'HOSTED_EXTRA_KITA_EUR muss eine ganze Zahl ab 0 sein: "9,50"',
    ])
    // Both at once: the number and the missing mail server
    expect(
      problems({
        ...hosted,
        SMTP_HOST: undefined,
        HOSTED_INCLUDED_KITAS: '-1',
      }),
    ).toHaveLength(2)
  })

  // The terms an account agrees to have a name, and invoice requests an
  // address to go to
  test('hosted needs the version of the terms and the operator’s address', () => {
    expect(
      problems({
        ...hosted,
        HOSTED_TERMS_VERSION: ' ',
        HOSTED_OPERATOR_EMAIL: undefined,
      }),
    ).toEqual([
      'HOSTED_TERMS_VERSION fehlt (Pflicht mit HOSTED=true)',
      'HOSTED_OPERATOR_EMAIL fehlt (Pflicht mit HOSTED=true)',
    ])
    expect(problems({ ...hosted, HOSTED_OPERATOR_EMAIL: 'betrieb' })).toEqual([
      'HOSTED_OPERATOR_EMAIL muss eine E-Mail-Adresse sein: "betrieb"',
    ])
    // Self-hosted, nobody asks for them
    expect(problems(valid)).toEqual([])
  })

  // Every mail names who sends it (src/lib/mail/footer.ts). A self-hosted
  // instance only gets a warning in its log; the hosted one doesn't start.
  test('hosted needs the operator details, self-hosted does not', () => {
    expect(
      problems({
        ...hosted,
        OPERATOR_NAME: undefined,
        OPERATOR_ADDRESS: ' ',
        OPERATOR_EMAIL: '',
      }),
    ).toEqual([
      'OPERATOR_NAME fehlt (Pflicht mit HOSTED=true)',
      'OPERATOR_ADDRESS fehlt (Pflicht mit HOSTED=true)',
      'OPERATOR_EMAIL fehlt (Pflicht mit HOSTED=true)',
    ])
    expect(problems({ ...hosted, OPERATOR_LEGAL_INFO: 'HRB 12345' })).toEqual(
      [],
    )
    expect(problems({ ...valid, HOSTED: 'false' })).toEqual([])
    // What is set has to be right on either kind
    expect(
      problems({ ...valid, OPERATOR_NAME: 'Kibo | www.kibo.example' }),
    ).toHaveLength(1)
    expect(
      problems({ ...valid, IMPRESSUM_URL: 'http://kibo.example/impressum' }),
    ).toEqual([
      'IMPRESSUM_URL muss eine Adresse mit https:// sein: "http://kibo.example/impressum"',
    ])
    // The mail that confirms an agreement links the terms
    expect(problems({ ...hosted, AGB_URL: '/agb', AVV_URL: 'avv' })).toEqual([
      'AGB_URL muss eine Adresse mit https:// sein: "/agb"',
      'AVV_URL muss eine Adresse mit https:// sein: "avv"',
    ])
  })

  // Every mail links imprint and privacy policy, and the first Kita agrees
  // to the terms and the data processing agreement
  describe('the legal pages', () => {
    const IMPRESSUM =
      'HOSTED=true braucht ein Impressum: IMPRESSUM_URL setzen oder impressum.md in LEGAL_DIR'
    const DATENSCHUTZ =
      'HOSTED=true braucht eine Datenschutzerklärung: DATENSCHUTZ_URL setzen oder datenschutz.md in LEGAL_DIR'
    const AGB =
      'HOSTED=true braucht die AGB: AGB_URL setzen oder agb.md in LEGAL_DIR'
    const AVV =
      'HOSTED=true braucht den AV-Vertrag: AVV_URL setzen oder avv.md in LEGAL_DIR'
    const legalDir = mkdtempSync(join(tmpdir(), 'kibo-legal-'))
    const withoutUrls = {
      ...hosted,
      IMPRESSUM_URL: undefined,
      DATENSCHUTZ_URL: ' ',
      AGB_URL: '',
      AVV_URL: undefined,
      LEGAL_DIR: legalDir,
    }
    const missingIn = (directory: string, ...what: string[]) =>
      what.map((problem) => `${problem} (${directory}) hinterlegen`)

    afterAll(() => rmSync(legalDir, { recursive: true, force: true }))

    test('hosted needs all four, each as an address or as a file', () => {
      expect(problems(hosted)).toEqual([])
      expect(problems(withoutUrls)).toEqual(
        missingIn(legalDir, IMPRESSUM, DATENSCHUTZ, AGB, AVV),
      )
      // One as a file, the other as an address
      writeFileSync(join(legalDir, 'impressum.md'), '## Entwurf\n')
      writeFileSync(join(legalDir, 'agb.md'), '## Entwurf\n')
      expect(problems(withoutUrls)).toEqual(
        missingIn(legalDir, DATENSCHUTZ, AVV),
      )
      expect(
        problems({
          ...withoutUrls,
          DATENSCHUTZ_URL: 'https://kibo.example/datenschutz',
          AVV_URL: 'https://kibo.example/avv',
        }),
      ).toEqual([])
      writeFileSync(join(legalDir, 'datenschutz.md'), '## Entwurf\n')
      writeFileSync(join(legalDir, 'avv.md'), '## Entwurf\n')
      expect(problems(withoutUrls)).toEqual([])
    })

    // The links in every mail would lead to a page that says nothing
    test('hosted refuses to start without the imprint or the privacy policy', () => {
      const empty = mkdtempSync(join(tmpdir(), 'kibo-legal-'))
      try {
        expect(
          problems({ ...hosted, IMPRESSUM_URL: '', LEGAL_DIR: empty }),
        ).toEqual(missingIn(empty, IMPRESSUM))
        expect(
          problems({ ...hosted, DATENSCHUTZ_URL: undefined, LEGAL_DIR: empty }),
        ).toEqual(missingIn(empty, DATENSCHUTZ))
      } finally {
        rmSync(empty, { recursive: true, force: true })
      }
    })

    test('a directory that is not there has no file', () => {
      const directory = join(legalDir, 'gibt-es-nicht')
      expect(
        hostedLegalProblems({ HOSTED: 'true', LEGAL_DIR: directory }),
      ).toEqual(missingIn(directory, IMPRESSUM, DATENSCHUTZ, AGB, AVV))
    })

    test('self-hosted needs none of them', () => {
      for (const HOSTED of ['false', '', undefined]) {
        expect(hostedLegalProblems({ HOSTED, LEGAL_DIR: legalDir })).toEqual([])
        expect(
          problems({ ...valid, HOSTED, LEGAL_DIR: join(legalDir, 'leer') }),
        ).toEqual([])
      }
    })
  })

  test('refuses a DOCS_URL that is no web address', () => {
    expect(problems({ ...valid, DOCS_URL: 'kibo' })).toEqual([
      'DOCS_URL muss eine Adresse mit http:// oder https:// sein: "kibo"',
    ])
    expect(
      problems({ ...valid, DOCS_URL: 'javascript:alert(1)' }),
    ).toHaveLength(1)
  })
})

describe('the source link and the price note', () => {
  test('start with both, with either and with neither', () => {
    expect(
      problems({
        ...valid,
        SOURCE_URL: 'https://git.kita-verbund.de/it/kibo',
        HOSTED_PRICE_NOTE: 'Alle Preise zzgl. 19 % Umsatzsteuer.',
      }),
    ).toEqual([])
    expect(
      problems({ ...valid, SOURCE_URL: '', HOSTED_PRICE_NOTE: undefined }),
    ).toEqual([])
  })

  test('refuses a SOURCE_URL that is no web address', () => {
    expect(problems({ ...valid, SOURCE_URL: 'kibo' })).toEqual([
      'SOURCE_URL muss eine Adresse mit http:// oder https:// sein: "kibo"',
    ])
    expect(
      problems({ ...valid, SOURCE_URL: 'javascript:alert(1)' }),
    ).toHaveLength(1)
  })

  test('refuses a price note with a link or a second line', () => {
    expect(
      problems({ ...valid, HOSTED_PRICE_NOTE: 'siehe https://example.org' }),
    ).toEqual([
      'HOSTED_PRICE_NOTE muss eine Zeile mit höchstens 200 Zeichen ohne Link sein: "siehe https://example.org"',
    ])
    expect(
      problems({ ...valid, HOSTED_PRICE_NOTE: 'zzgl. USt.\nzzgl. Versand' }),
    ).toHaveLength(1)
    expect(
      problems({ ...valid, HOSTED_PRICE_NOTE: 'x'.repeat(201) }),
    ).toHaveLength(1)
  })
})

describe('page-view counting', () => {
  test('starts with both, with the domain alone and with neither', () => {
    expect(
      problems({
        ...hosted,
        PLAUSIBLE_DOMAIN: 'kibo.example',
        PLAUSIBLE_URL: 'https://stats.kibo.example/',
      }),
    ).toEqual([])
    expect(problems({ ...valid, PLAUSIBLE_DOMAIN: 'kibo.example' })).toEqual([])
    expect(
      problems({ ...valid, PLAUSIBLE_DOMAIN: ' ', PLAUSIBLE_URL: undefined }),
    ).toEqual([])
  })

  // Hosted or not: without HOSTED nothing is counted, but a typo stays one
  test('refuses a domain or an address it cannot use', () => {
    expect(
      problems({ ...valid, PLAUSIBLE_DOMAIN: 'https://kibo.example/' }),
    ).toEqual([
      'PLAUSIBLE_DOMAIN muss ein Domainname sein, wie er in Plausible eingetragen ist: "https://kibo.example/"',
    ])
    for (const PLAUSIBLE_URL of [
      'plausible.io',
      'javascript:alert(1)',
      'https://key@plausible.io',
      'https://plausible.io/?site=kibo',
    ]) {
      expect(problems({ ...valid, PLAUSIBLE_URL })).toEqual([
        `PLAUSIBLE_URL muss eine Adresse mit http:// oder https:// sein, ohne Zugangsdaten, Query und Fragment: "${PLAUSIBLE_URL}"`,
      ])
    }
  })
})

describe('VAPID configuration', () => {
  // As `bunx @pushforge/builder vapid` prints them (the RFC 8291 example key)
  const vapid = {
    VAPID_PUBLIC_KEY: RFC8291_SERVER_KEYS.publicKey,
    VAPID_PRIVATE_KEY: JSON.stringify({
      alg: 'ES256',
      key_ops: ['sign'],
      ext: true,
      ...RFC8291_SERVER_KEYS.privateJwk,
    }),
    VAPID_SUBJECT: 'mailto:kita@example.org',
  }

  test('starts with all three or none', () => {
    expect(problems({ ...valid, ...vapid })).toEqual([])
    expect(
      problems({ ...valid, ...vapid, VAPID_SUBJECT: 'https://kita.example' }),
    ).toEqual([])
    expect(
      problems({
        ...valid,
        VAPID_PUBLIC_KEY: '',
        VAPID_PRIVATE_KEY: ' ',
        VAPID_SUBJECT: undefined,
      }),
    ).toEqual([])
  })

  test('refuses a partial configuration and names what is missing', () => {
    expect(
      problems({
        ...valid,
        ...vapid,
        VAPID_PRIVATE_KEY: '',
        VAPID_SUBJECT: '',
      }),
    ).toEqual([
      'Web-Push braucht alle drei VAPID-Variablen, es fehlt: VAPID_PRIVATE_KEY, VAPID_SUBJECT',
    ])
    expect(
      problems({ ...valid, VAPID_SUBJECT: vapid.VAPID_SUBJECT }),
    ).toHaveLength(1)
  })

  test('checks the format of each value', () => {
    for (const broken of [
      { VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY.slice(1) },
      { VAPID_PUBLIC_KEY: `A${vapid.VAPID_PUBLIC_KEY.slice(1)}` },
      { VAPID_PRIVATE_KEY: 'kein json' },
      { VAPID_PRIVATE_KEY: JSON.stringify({ kty: 'RSA', n: 'x', e: 'AQAB' }) },
      { VAPID_SUBJECT: 'kita@example.org' },
      { VAPID_SUBJECT: 'http://kita.example' },
    ]) {
      expect(problems({ ...valid, ...vapid, ...broken })).toHaveLength(1)
    }
  })

  test('refuses a public key that belongs to another private key', () => {
    const other =
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
    expect(problems({ ...valid, ...vapid, VAPID_PUBLIC_KEY: other })).toEqual([
      'VAPID_PUBLIC_KEY passt nicht zu VAPID_PRIVATE_KEY',
    ])
  })
})

describe('withSecurityHeaders', () => {
  const page = () =>
    new Response('<!doctype html>', {
      headers: {
        'content-type': 'text/html',
        'content-security-policy': "default-src 'self'",
      },
    })

  test('sets the common headers and keeps the policy Astro rendered', () => {
    const { headers } = withSecurityHeaders('/', page())
    expect(headers.get('content-security-policy')).toBe("default-src 'self'")
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(headers.get('permissions-policy')).toContain('camera=()')
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(headers.get('x-robots-tag')).toBeNull()
    expect(headers.get('cache-control')).toBeNull()
  })

  test('gives everything that is not a page a policy that allows nothing', () => {
    const json = Response.json({ ok: true })
    const policy = withSecurityHeaders('/api/health', json).headers.get(
      'content-security-policy',
    )
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  test('keeps Kita links and reset links out of the Referer', () => {
    for (const path of [
      '/k/abcdefghijklmnopqrstuv/',
      '/k/abcdefghijklmnopqrstuv/3f0c2a52-8a3e-4d7e-9f45-0b8d8f3e2c11/',
      '/k/abcdefghijklmnopqrstuv',
      '/admin/reset-password',
    ]) {
      expect(
        withSecurityHeaders(path, page()).headers.get('referrer-policy'),
      ).toBe('no-referrer')
    }
    for (const path of ['/kontakt', '/bretter', '/kita', '/b/abc']) {
      expect(
        withSecurityHeaders(path, page()).headers.get('referrer-policy'),
      ).toBe('strict-origin-when-cross-origin')
    }
  })

  test('keeps admin pages and actions out of caches and search engines', () => {
    const admin = withSecurityHeaders('/admin/boards', page()).headers
    expect(admin.get('cache-control')).toBe('private, no-store')
    expect(admin.get('x-robots-tag')).toBe('noindex, nofollow')
    const action = withSecurityHeaders('/_actions/notes.create', page()).headers
    expect(action.get('cache-control')).toBe('private, no-store')
  })

  test('revalidates the Kita and its boards every time and keeps them out of search engines', () => {
    for (const path of [
      '/k/abcdefghijklmnopqrstuv/',
      '/k/abcdefghijklmnopqrstuv/3f0c2a52-8a3e-4d7e-9f45-0b8d8f3e2c11/',
    ]) {
      const { headers } = withSecurityHeaders(path, page())
      expect(headers.get('cache-control')).toBe('private, no-cache')
      expect(headers.get('x-robots-tag')).toBe('noindex, nofollow')
    }
  })

  // /docs exists on the hosted instance only, and there it is meant to be
  // found: a page like the start page, with the policy Astro rendered
  test('leaves the documentation open to search engines and caches', () => {
    for (const path of ['/docs', '/docs/fuer-kitas/zettel']) {
      const { headers } = withSecurityHeaders(path, page())
      expect(headers.get('content-security-policy')).toBe("default-src 'self'")
      expect(headers.get('x-robots-tag')).toBeNull()
      expect(headers.get('cache-control')).toBeNull()
      expect(headers.get('referrer-policy')).toBe(
        'strict-origin-when-cross-origin',
      )
      expect(headers.get('x-frame-options')).toBe('DENY')
    }
  })

  test("treats a Kita's manifest like its pages", () => {
    const manifest = new Response('{}', {
      headers: { 'content-type': 'application/manifest+json' },
    })
    const { headers } = withSecurityHeaders(
      '/k/abcdefghijklmnopqrstuv/manifest.webmanifest',
      manifest,
    )
    expect(headers.get('cache-control')).toBe('private, no-cache')
    expect(headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
    expect(headers.get('content-type')).toBe('application/manifest+json')
  })

  test('copies a response whose headers cannot be changed', () => {
    const redirect = Response.redirect('https://kibo.example/admin', 302)
    const result = withSecurityHeaders('/admin', redirect)
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe('https://kibo.example/admin')
    expect(result.headers.get('x-frame-options')).toBe('DENY')
  })
})

// What scripts/server.mjs does once the configuration passed: start the
// server and load the app's start-up hook with the middleware — which can
// refuse to run (src/lib/server/runtime.ts: terms that read differently
// under a stored HOSTED_TERMS_VERSION). Run as a program on a stand-in for
// the build.
describe('the start-up hook', () => {
  const builds: string[] = []
  afterAll(() => {
    for (const build of builds) rmSync(build, { recursive: true, force: true })
  })

  function build(middleware: string) {
    const directory = mkdtempSync(join(tmpdir(), 'kibo-server-start-'))
    builds.push(directory)
    mkdirSync(join(directory, 'dist/server'), { recursive: true })
    writeFileSync(
      join(directory, 'dist/server/entry.mjs'),
      'export const startServer = () => ({ server: { server: {} } })\n',
    )
    writeFileSync(
      join(directory, 'dist/server/virtual_astro_middleware.mjs'),
      middleware,
    )
    return directory
  }

  async function start(cwd: string) {
    const server = Bun.spawn(
      [process.execPath, resolve('scripts/server.mjs')],
      { cwd, env: { ...valid, PATH: process.env.PATH }, stderr: 'pipe' },
    )
    const [code, stderr] = await Promise.all([
      server.exited,
      new Response(server.stderr).text(),
    ])
    return { code, stderr }
  }

  test('a hook that refuses stops the server with its reason', async () => {
    const refusing = build(
      'await Promise.resolve()\nthrow new Error(\'HOSTED_TERMS_VERSION "2026-10" ist bereits mit einem anderen Text von agb.md gespeichert.\')\n',
    )
    expect(await start(refusing)).toEqual({
      code: 1,
      stderr:
        '[server] Kibo startet nicht: HOSTED_TERMS_VERSION "2026-10" ist bereits mit einem anderen Text von agb.md gespeichert.\n',
    })
  })

  test('a hook that loads lets it run', async () => {
    expect(await start(build('export const onRequest = () => {}\n'))).toEqual({
      code: 0,
      stderr: '',
    })
  })
})
