import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DOCS_URL,
  DEFAULT_PLAUSIBLE_URL,
  emailDomainOf,
  HOSTED_PRICING_DEFAULTS,
  hostedPricingProblems,
  instanceConfigProblems,
  isEmailDomainAllowed,
  missingOperatorDetails,
  normalizeEmailDomain,
  parseDocsUrl,
  parseEmailDomains,
  parseHosted,
  parseHostedPricing,
  parseLegalUrl,
  parseOperatorAddress,
  parseOperatorDetails,
  parseOperatorEmail,
  parseOperatorLegalInfo,
  parseOperatorName,
  parsePlausibleDomain,
  parsePlausibleUrl,
  parsePriceNote,
  parseSignupMode,
  parseSourceUrl,
  parseTermsVersion,
  REPOSITORY_URL,
} from '../scripts/instance-config.mjs'

// Written as code points, so nothing invisible hides in this file
const char = (code: number) => String.fromCodePoint(code)

describe('parseSignupMode', () => {
  test('is open unless told otherwise', () => {
    expect(parseSignupMode(undefined)).toBe('open')
    expect(parseSignupMode('')).toBe('open')
    expect(parseSignupMode('  ')).toBe('open')
    expect(parseSignupMode('open')).toBe('open')
  })

  test('takes closed, with whitespace around it', () => {
    expect(parseSignupMode('closed')).toBe('closed')
    expect(parseSignupMode(' closed ')).toBe('closed')
  })

  // A typo must not quietly mean "open"
  test('knows no other spelling', () => {
    for (const value of ['Open', 'CLOSED', 'yes', 'false', 'geschlossen']) {
      expect(parseSignupMode(value)).toBeUndefined()
    }
  })
})

describe('normalizeEmailDomain', () => {
  test('compares domains the way DNS does', () => {
    expect(normalizeEmailDomain('kita-verbund.de')).toBe('kita-verbund.de')
    expect(normalizeEmailDomain(' Kita-Verbund.DE. ')).toBe('kita-verbund.de')
    expect(normalizeEmailDomain('müller.de')).toBe('xn--mller-kva.de')
    expect(normalizeEmailDomain('MÜLLER.de')).toBe('xn--mller-kva.de')
    expect(normalizeEmailDomain('nord.kita.example')).toBe('nord.kita.example')
  })

  test('takes a wildcard in front of a domain and nowhere else', () => {
    expect(normalizeEmailDomain('*.x.de')).toBe('*.x.de')
    expect(normalizeEmailDomain('*.Nord.Kita-Verbund.de.')).toBe(
      '*.nord.kita-verbund.de',
    )
    for (const entry of ['*', '*.', '**.x.de', 'a.*.de', '*x.de', '*.de']) {
      expect(normalizeEmailDomain(entry)).toBeUndefined()
    }
  })

  test('refuses everything that is no domain', () => {
    for (const entry of [
      'x',
      '-a.de',
      'a-.de',
      'a..de',
      'a_b.de',
      'a b.de',
      'a.de/x',
      'a.de/',
      'a.de:25',
      // The default port, which the URL parser would drop without a trace
      'a.de:80',
      '1.2.3.4',
      '0x7f.1',
      '[::1]',
      'user@x.de',
      '@x.de',
      'a%2Ede',
      'https://a.de',
      `${'a'.repeat(64)}.de`,
    ]) {
      expect(normalizeEmailDomain(entry)).toBeUndefined()
    }
  })

  test('stops at the longest name DNS allows', () => {
    const label = (char: string, length = 63) => char.repeat(length)
    const fits = [label('a'), label('b'), label('c'), label('d', 61)].join('.')
    expect(fits).toHaveLength(253)
    expect(normalizeEmailDomain(fits)).toBe(fits)
    expect(normalizeEmailDomain(`${fits}d`)).toBeUndefined()
  })
})

describe('parseEmailDomains', () => {
  test('is empty for nothing', () => {
    expect(parseEmailDomains(undefined)).toEqual({ domains: [], invalid: [] })
    expect(parseEmailDomains(' , ,')).toEqual({ domains: [], invalid: [] })
  })

  test('normalises the entries and keeps their order, each once', () => {
    expect(
      parseEmailDomains(
        ' Kita-Verbund.de ,, *.kita-verbund.de,kita-verbund.DE.,traeger.example',
      ),
    ).toEqual({
      domains: ['kita-verbund.de', '*.kita-verbund.de', 'traeger.example'],
      invalid: [],
    })
  })

  test('hands back what it cannot parse the way it was typed', () => {
    expect(parseEmailDomains('kita.de, *, Kita .de ,@kita.de')).toEqual({
      domains: ['kita.de'],
      invalid: ['*', 'Kita .de', '@kita.de'],
    })
  })
})

describe('emailDomainOf', () => {
  test('is what follows the last @', () => {
    expect(emailDomainOf('Anna@Kita-Verbund.DE')).toBe('kita-verbund.de')
    expect(emailDomainOf('"a@b"@kita.de')).toBe('kita.de')
    expect(emailDomainOf('anna@müller.de')).toBe('xn--mller-kva.de')
  })

  test('is nothing without an address in front or a domain behind', () => {
    for (const email of ['', 'anna', '@kita.de', 'anna@', 'anna@kita']) {
      expect(emailDomainOf(email)).toBeUndefined()
    }
  })
})

describe('isEmailDomainAllowed', () => {
  test('an empty list restricts nothing', () => {
    expect(isEmailDomainAllowed('anna@gmail.com', [])).toBe(true)
    expect(isEmailDomainAllowed('keine adresse', [])).toBe(true)
  })

  test('an exact entry matches that domain only', () => {
    const domains = ['kita-verbund.de']
    expect(isEmailDomainAllowed('anna@kita-verbund.de', domains)).toBe(true)
    expect(isEmailDomainAllowed('anna@nord.kita-verbund.de', domains)).toBe(
      false,
    )
    expect(isEmailDomainAllowed('anna@gmail.com', domains)).toBe(false)
    // The list is not a suffix match
    expect(isEmailDomainAllowed('anna@evil-kita-verbund.de', domains)).toBe(
      false,
    )
    expect(
      isEmailDomainAllowed('anna@kita-verbund.de.evil.example', domains),
    ).toBe(false)
  })

  test('a wildcard matches subdomains at any depth, not the domain itself', () => {
    const domains = ['*.kita-verbund.de']
    expect(isEmailDomainAllowed('x@nord.kita-verbund.de', domains)).toBe(true)
    expect(isEmailDomainAllowed('x@a.nord.kita-verbund.de', domains)).toBe(true)
    expect(isEmailDomainAllowed('x@kita-verbund.de', domains)).toBe(false)
    expect(isEmailDomainAllowed('x@notkita-verbund.de', domains)).toBe(false)
    expect(
      isEmailDomainAllowed('x@kita-verbund.de', [
        'kita-verbund.de',
        '*.kita-verbund.de',
      ]),
    ).toBe(true)
  })

  test('ignores case and the spelling of an IDN in the address', () => {
    expect(
      isEmailDomainAllowed('Anna@Kita-Verbund.DE', ['kita-verbund.de']),
    ).toBe(true)
    expect(isEmailDomainAllowed('anna@MÜLLER.de', ['xn--mller-kva.de'])).toBe(
      true,
    )
    expect(
      isEmailDomainAllowed('anna@xn--mller-kva.de', ['xn--mller-kva.de']),
    ).toBe(true)
  })

  test('turns away what has no domain once there is a list', () => {
    for (const email of ['anna', 'anna@', '@kita.de', 'anna@kita.de/x']) {
      expect(isEmailDomainAllowed(email, ['kita.de'])).toBe(false)
    }
  })
})

describe('parseHosted', () => {
  test('is off unless told otherwise', () => {
    expect(parseHosted(undefined)).toBe(false)
    expect(parseHosted('')).toBe(false)
    expect(parseHosted('  ')).toBe(false)
    expect(parseHosted('false')).toBe(false)
  })

  test('takes true, with whitespace around it', () => {
    expect(parseHosted('true')).toBe(true)
    expect(parseHosted(' true ')).toBe(true)
    expect(parseHosted(' false\n')).toBe(false)
  })

  // What hangs on the switch is not for a typo to decide
  test('knows no other spelling', () => {
    for (const value of ['True', 'FALSE', '1', '0', 'yes', 'no', 'on', 'ja']) {
      expect(parseHosted(value)).toBeUndefined()
    }
  })
})

describe('parseDocsUrl', () => {
  test('is the documentation on GitHub unless told otherwise', () => {
    expect(DEFAULT_DOCS_URL).toBe(
      'https://github.com/florivdg/kibo/tree/main/docs',
    )
    expect(parseDocsUrl(undefined)).toBe(DEFAULT_DOCS_URL)
    expect(parseDocsUrl('')).toBe(DEFAULT_DOCS_URL)
    expect(parseDocsUrl('  ')).toBe(DEFAULT_DOCS_URL)
  })

  test('takes a web address', () => {
    expect(parseDocsUrl('https://kita-verbund.de/kibo/hilfe')).toBe(
      'https://kita-verbund.de/kibo/hilfe',
    )
    expect(parseDocsUrl(' http://intranet.example/kibo ')).toBe(
      'http://intranet.example/kibo',
    )
    expect(parseDocsUrl('https://kibo.example')).toBe('https://kibo.example/')
  })

  // The value ends up in an href: nothing a browser would run or resolve
  // against the page it is on
  test('refuses everything else', () => {
    for (const value of [
      'ftp://kita.example/hilfe',
      'javascript:alert(1)',
      'mailto:hilfe@kita.example',
      'github.com/florivdg/kibo',
      '/docs',
      '//kita.example/hilfe',
      'kibo',
      'https://',
    ]) {
      expect(parseDocsUrl(value)).toBeUndefined()
    }
  })
})

describe('parseSourceUrl', () => {
  test('is the repository unless told otherwise', () => {
    expect(REPOSITORY_URL).toBe('https://github.com/florivdg/kibo')
    expect(parseSourceUrl(undefined)).toBe(REPOSITORY_URL)
    expect(parseSourceUrl('')).toBe(REPOSITORY_URL)
    expect(parseSourceUrl('  ')).toBe(REPOSITORY_URL)
  })

  test('takes the address of a changed version', () => {
    expect(parseSourceUrl('https://git.kita-verbund.de/it/kibo')).toBe(
      'https://git.kita-verbund.de/it/kibo',
    )
    expect(parseSourceUrl(' http://intranet.example/kibo.tar.gz ')).toBe(
      'http://intranet.example/kibo.tar.gz',
    )
    expect(parseSourceUrl('https://example.org')).toBe('https://example.org/')
  })

  // The value ends up in an href on every page
  test('refuses everything that is no web address', () => {
    for (const value of [
      'ftp://kita.example/kibo',
      'javascript:alert(1)',
      'mailto:it@kita.example',
      'github.com/florivdg/kibo',
      '/quelltext',
      '//kita.example/kibo',
      'kibo',
      'https://',
    ]) {
      expect(parseSourceUrl(value)).toBeUndefined()
    }
  })
})

describe('parsePlausibleDomain', () => {
  test('is off unless set', () => {
    for (const raw of [undefined, '', '  ']) {
      expect(parsePlausibleDomain(raw)).toBe('')
    }
  })

  test('takes the domain the way Plausible knows it', () => {
    expect(parsePlausibleDomain('kibo.example')).toBe('kibo.example')
    expect(parsePlausibleDomain(' Kibo.Example. ')).toBe('kibo.example')
    expect(parsePlausibleDomain('www.kibo.example')).toBe('www.kibo.example')
    // Plausible matches the name as it was entered there
    expect(parsePlausibleDomain('Kibö.de')).toBe('kibö.de')
  })

  // Somebody copied the address out of the browser
  test('knows no scheme, path, port or IP address', () => {
    for (const raw of [
      'https://kibo.example',
      'kibo.example/',
      'kibo.example/start',
      'kibo.example:443',
      'localhost',
      '203.0.113.7',
      'a.de,b.de',
    ]) {
      expect(parsePlausibleDomain(raw)).toBeUndefined()
    }
  })
})

describe('parsePlausibleUrl', () => {
  test('is plausible.io unless set', () => {
    expect(DEFAULT_PLAUSIBLE_URL).toBe('https://plausible.io/')
    for (const raw of [undefined, '', '  ']) {
      expect(parsePlausibleUrl(raw)).toBe(DEFAULT_PLAUSIBLE_URL)
    }
  })

  // The script and the events are resolved against it
  test('ends with a slash, under a path as well', () => {
    expect(parsePlausibleUrl('https://stats.kibo.example')).toBe(
      'https://stats.kibo.example/',
    )
    expect(parsePlausibleUrl(' http://127.0.0.1:8000/plausible// ')).toBe(
      'http://127.0.0.1:8000/plausible/',
    )
    expect(parsePlausibleUrl('https://stats.kibo.example/p/')).toBe(
      'https://stats.kibo.example/p/',
    )
  })

  test('takes nothing but a plain http(s) address', () => {
    for (const raw of [
      'plausible.io',
      'ftp://plausible.io',
      'javascript:alert(1)',
      'https://user:secret@plausible.io',
      'https://plausible.io/?x=1',
      'https://plausible.io/#top',
    ]) {
      expect(parsePlausibleUrl(raw)).toBeUndefined()
    }
  })
})

describe('parsePriceNote', () => {
  test('is no note at all unless there is one', () => {
    expect(parsePriceNote(undefined)).toBe('')
    expect(parsePriceNote('')).toBe('')
    expect(parsePriceNote('  ')).toBe('')
  })

  test('takes one line of text', () => {
    expect(parsePriceNote(' Alle Preise zzgl. 19 % Umsatzsteuer. ')).toBe(
      'Alle Preise zzgl. 19 % Umsatzsteuer.',
    )
    expect(
      parsePriceNote('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'),
    ).toBe('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')
    expect(parsePriceNote('x'.repeat(200))).toBe('x'.repeat(200))
  })

  test('refuses more than a line, too much, and what nobody can see', () => {
    for (const value of [
      'x'.repeat(201),
      'zzgl. USt.\nund Versand',
      'zzgl.\tUSt.',
      `zzgl.${char(0)}USt.`,
      // Reads differently from how it is stored
      `zzgl. ${char(0x202e)}.tSU`,
      `zzgl.${char(0x2028)}USt.`,
      char(0x200b),
      `${char(0x200b)} ${char(0x3164)}`,
    ]) {
      expect(parsePriceNote(value)).toBeUndefined()
    }
  })

  // The line stands on the start page and in the admin area
  test('refuses a link', () => {
    for (const value of [
      'Mehr unter https://example.org/preise',
      'Mehr unter www.example.org',
      'Mehr unter HTTP:example.org',
      'siehe ftp://example.org',
    ]) {
      expect(parsePriceNote(value)).toBeUndefined()
    }
  })
})

describe('parseHostedPricing', () => {
  const DEFAULTS = {
    priceEur: 49,
    includedKitas: 3,
    extraKitaEur: 10,
    trialDays: 30,
  }

  test('is 49 € for three Kitas, 10 € each after, 30 days to try', () => {
    expect(HOSTED_PRICING_DEFAULTS).toEqual(DEFAULTS)
    expect(parseHostedPricing({})).toEqual(DEFAULTS)
    expect(
      parseHostedPricing({
        HOSTED_PRICE_EUR: '',
        HOSTED_INCLUDED_KITAS: '  ',
        HOSTED_EXTRA_KITA_EUR: undefined,
        HOSTED_TRIAL_DAYS: '',
      }),
    ).toEqual(DEFAULTS)
    // A copy: changing what was parsed leaves the defaults alone
    expect(parseHostedPricing({})).not.toBe(HOSTED_PRICING_DEFAULTS)
  })

  test('takes whole numbers, with whitespace around them', () => {
    expect(
      parseHostedPricing({
        HOSTED_PRICE_EUR: ' 120 ',
        HOSTED_INCLUDED_KITAS: '5',
        HOSTED_EXTRA_KITA_EUR: '15',
        HOSTED_TRIAL_DAYS: '14',
      }),
    ).toEqual({
      priceEur: 120,
      includedKitas: 5,
      extraKitaEur: 15,
      trialDays: 14,
    })
    expect(parseHostedPricing({ HOSTED_PRICE_EUR: '007' })?.priceEur).toBe(7)
  })

  test('lets everything but the trial be zero', () => {
    expect(
      parseHostedPricing({
        HOSTED_PRICE_EUR: '0',
        HOSTED_INCLUDED_KITAS: '0',
        HOSTED_EXTRA_KITA_EUR: '0',
        HOSTED_TRIAL_DAYS: '1',
      }),
    ).toEqual({ priceEur: 0, includedKitas: 0, extraKitaEur: 0, trialDays: 1 })
    expect(parseHostedPricing({ HOSTED_TRIAL_DAYS: '0' })).toBeUndefined()
    expect(parseHostedPricing({ HOSTED_PRICE_EUR: '999999' })?.priceEur).toBe(
      999999,
    )
  })

  // Number() would take most of these
  test('refuses everything that is no whole number', () => {
    for (const value of [
      '-1',
      '+1',
      '1.5',
      '1,5',
      'abc',
      '1e3',
      '0x10',
      '49 €',
      '1 000',
      '1000000',
      'Infinity',
    ]) {
      for (const name of [
        'HOSTED_PRICE_EUR',
        'HOSTED_INCLUDED_KITAS',
        'HOSTED_EXTRA_KITA_EUR',
        'HOSTED_TRIAL_DAYS',
      ]) {
        expect(parseHostedPricing({ [name]: value })).toBeUndefined()
        expect(hostedPricingProblems({ [name]: value })).toHaveLength(1)
      }
    }
  })
})

describe('parseTermsVersion', () => {
  // It is part of an address (/agb/<version>), taken as it is
  test('takes a name made for an address', () => {
    expect(parseTermsVersion('2026-10')).toBe('2026-10')
    expect(parseTermsVersion('  v2.1_entwurf ')).toBe('v2.1_entwurf')
    expect(parseTermsVersion('x'.repeat(64))).toBe('x'.repeat(64))
  })

  test('knows no version that is empty, too long or more than a word', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      'x'.repeat(65),
      'Fassung vom 1. Oktober 2026',
      '2026/10',
      '..',
      '-2026',
      '2026?10',
      '2026\n10',
      'Ä-2026',
    ]) {
      expect(parseTermsVersion(value)).toBeUndefined()
    }
  })
})

describe('parseOperatorEmail', () => {
  test('takes an address, with whitespace around it', () => {
    expect(parseOperatorEmail('betrieb@kibo.example')).toBe(
      'betrieb@kibo.example',
    )
    expect(parseOperatorEmail(' Betrieb@Kibo.example ')).toBe(
      'Betrieb@Kibo.example',
    )
  })

  test('refuses what is no address', () => {
    for (const value of [
      undefined,
      '',
      'betrieb',
      'betrieb@kibo',
      '@kibo.example',
      'a b@kibo.example',
      'a@kibo.example, b@kibo.example',
      'Betrieb <betrieb@kibo.example>',
    ]) {
      expect(parseOperatorEmail(value)).toBeUndefined()
    }
  })

  // The address ends up verbatim in every mail footer and in the notice of
  // an invitation
  test('refuses control and bidi characters', () => {
    for (const code of [0x7, 0x202e, 0x2066, 0x2028]) {
      expect(
        parseOperatorEmail(`kontakt${char(code)}@kibo.example`),
      ).toBeUndefined()
    }
  })
})

describe('the operator details', () => {
  test('take the address and the legal information line by line', () => {
    expect(
      parseOperatorDetails({
        OPERATOR_NAME: '  Kibo Betrieb GmbH ',
        OPERATOR_ADDRESS: 'Musterstraße 1 |  | 12345 Musterstadt|Deutschland',
        OPERATOR_EMAIL: ' kontakt@kibo.example ',
        OPERATOR_LEGAL_INFO:
          'Amtsgericht Musterstadt, HRB 12345\nGeschäftsführung: Anna Beispiel',
      }),
    ).toEqual({
      name: 'Kibo Betrieb GmbH',
      address: ['Musterstraße 1', '12345 Musterstadt', 'Deutschland'],
      email: 'kontakt@kibo.example',
      legalInfo: [
        'Amtsgericht Musterstadt, HRB 12345',
        'Geschäftsführung: Anna Beispiel',
      ],
    })
  })

  test('are empty when unset', () => {
    expect(parseOperatorDetails({})).toEqual({
      name: '',
      address: [],
      email: '',
      legalInfo: [],
    })
    expect(parseOperatorName(' ')).toBe('')
    expect(parseOperatorAddress(undefined)).toEqual([])
    expect(parseOperatorLegalInfo('')).toEqual([])
  })

  test('hold every line to the rules of plain text', () => {
    for (const value of [
      'Kita | Träger',
      'Kita https://kita.example',
      `Kita${char(0x7)}`,
      `Kita${char(0x2066)}`,
      char(0x3164),
      'x'.repeat(121),
    ]) {
      expect(parseOperatorName(value)).toBeUndefined()
    }
    expect(parseOperatorAddress('a|b|c|d|e')).toHaveLength(5)
    expect(parseOperatorAddress('a|b|c|d|e|f')).toBeUndefined()
    expect(parseOperatorAddress('Postfach | www.kita.example')).toBeUndefined()
    // The legal information may name a web address
    expect(
      parseOperatorLegalInfo('Register: https://register.example'),
    ).toEqual(['Register: https://register.example'])
    expect(parseOperatorLegalInfo('1|2|3|4|5|6|7|8|9')).toBeUndefined()
    expect(parseOperatorLegalInfo('x'.repeat(201))).toBeUndefined()
    expect(parseOperatorDetails({ OPERATOR_EMAIL: 'kontakt' })).toBeUndefined()
    for (const code of [0x7, 0x202e]) {
      expect(
        parseOperatorDetails({
          OPERATOR_EMAIL: `kontakt${char(code)}@kibo.example`,
        }),
      ).toBeUndefined()
    }
  })

  test('name what a mail footer can not do without', () => {
    expect(
      missingOperatorDetails({ name: '', address: [], email: '' }),
    ).toEqual(['OPERATOR_NAME', 'OPERATOR_ADDRESS', 'OPERATOR_EMAIL'])
    expect(
      missingOperatorDetails({
        name: 'Kibo Betrieb GmbH',
        address: ['Musterstraße 1'],
        email: '',
      }),
    ).toEqual(['OPERATOR_EMAIL'])
  })
})

describe('parseLegalUrl', () => {
  test('takes a complete https:// address, or nothing', () => {
    expect(parseLegalUrl(' https://traeger.example/impressum ')).toBe(
      'https://traeger.example/impressum',
    )
    expect(parseLegalUrl(undefined)).toBe('')
    expect(parseLegalUrl(' ')).toBe('')
    for (const value of [
      '/impressum',
      'traeger.example/impressum',
      'http://traeger.example/impressum',
      'mailto:kontakt@traeger.example',
    ]) {
      expect(parseLegalUrl(value)).toBeUndefined()
    }
  })
})

describe('instanceConfigProblems', () => {
  const OPERATOR = {
    OPERATOR_NAME: 'Kibo Betrieb GmbH',
    OPERATOR_ADDRESS: 'Musterstraße 1 | 12345 Musterstadt',
    OPERATOR_EMAIL: 'kontakt@kibo.example',
  }
  const HOSTED_REQUIRED = {
    HOSTED_TERMS_VERSION: '2026-10',
    HOSTED_OPERATOR_EMAIL: 'betrieb@kibo.example',
    ...OPERATOR,
  }

  test('finds nothing wrong with unset or valid values', () => {
    expect(instanceConfigProblems({})).toEqual([])
    expect(
      instanceConfigProblems({
        SIGNUP_MODE: 'closed',
        SIGNUP_EMAIL_DOMAINS: 'kita-verbund.de, *.kita-verbund.de',
        HOSTED: 'true',
        DOCS_URL: 'https://kita-verbund.de/hilfe',
        ...HOSTED_REQUIRED,
      }),
    ).toEqual([])
    expect(instanceConfigProblems({ HOSTED: 'false', DOCS_URL: '' })).toEqual(
      [],
    )
  })

  test('names a HOSTED and a DOCS_URL it cannot parse', () => {
    expect(
      instanceConfigProblems({ HOSTED: ' yes ', DOCS_URL: ' kibo ' }),
    ).toEqual([
      'HOSTED muss true oder false sein: "yes"',
      'DOCS_URL muss eine Adresse mit http:// oder https:// sein: "kibo"',
    ])
  })

  test('names a SOURCE_URL and a price note it cannot parse', () => {
    expect(
      instanceConfigProblems({
        SOURCE_URL: ' kibo ',
        HOSTED_PRICE_NOTE: ' Preise: www.example.org ',
      }),
    ).toEqual([
      'SOURCE_URL muss eine Adresse mit http:// oder https:// sein: "kibo"',
      'HOSTED_PRICE_NOTE muss eine Zeile mit höchstens 200 Zeichen ohne Link sein: "Preise: www.example.org"',
    ])
    // Both are checked whether or not the instance is hosted, and both may
    // be missing or set on either kind
    for (const HOSTED of ['false', '', undefined]) {
      expect(
        instanceConfigProblems({
          HOSTED,
          SOURCE_URL: 'https://git.kita-verbund.de/it/kibo',
          HOSTED_PRICE_NOTE: 'zzgl. 19 % USt.',
        }),
      ).toEqual([])
    }
    expect(
      instanceConfigProblems({ SOURCE_URL: '', HOSTED_PRICE_NOTE: ' ' }),
    ).toEqual([])
  })

  test('names every HOSTED_* number it cannot parse', () => {
    expect(
      instanceConfigProblems({
        HOSTED_PRICE_EUR: ' abc ',
        HOSTED_INCLUDED_KITAS: '3',
        HOSTED_EXTRA_KITA_EUR: '1.5',
        HOSTED_TRIAL_DAYS: '0',
      }),
    ).toEqual([
      'HOSTED_PRICE_EUR muss eine ganze Zahl ab 0 sein: "abc"',
      'HOSTED_EXTRA_KITA_EUR muss eine ganze Zahl ab 0 sein: "1.5"',
      'HOSTED_TRIAL_DAYS muss eine ganze Zahl ab 1 sein: "0"',
    ])
    // Checked whether or not the instance is hosted
    expect(
      instanceConfigProblems({ HOSTED: 'false', HOSTED_TRIAL_DAYS: '-5' }),
    ).toEqual(['HOSTED_TRIAL_DAYS muss eine ganze Zahl ab 1 sein: "-5"'])
  })

  test('the hosted instance needs its terms version, an operator address and the operator details', () => {
    expect(instanceConfigProblems({ HOSTED: 'true' })).toEqual([
      'HOSTED_TERMS_VERSION fehlt (Pflicht mit HOSTED=true)',
      'HOSTED_OPERATOR_EMAIL fehlt (Pflicht mit HOSTED=true)',
      'OPERATOR_NAME fehlt (Pflicht mit HOSTED=true)',
      'OPERATOR_ADDRESS fehlt (Pflicht mit HOSTED=true)',
      'OPERATOR_EMAIL fehlt (Pflicht mit HOSTED=true)',
    ])
    expect(
      instanceConfigProblems({
        HOSTED: ' true ',
        ...HOSTED_REQUIRED,
        HOSTED_OPERATOR_EMAIL: '  ',
      }),
    ).toEqual(['HOSTED_OPERATOR_EMAIL fehlt (Pflicht mit HOSTED=true)'])
    // A separator alone is no address
    expect(
      instanceConfigProblems({
        HOSTED: 'true',
        ...HOSTED_REQUIRED,
        OPERATOR_ADDRESS: ' | ',
      }),
    ).toEqual([
      'OPERATOR_ADDRESS muss höchstens 5 Zeilen (getrennt durch |) mit je höchstens 100 Zeichen ohne Link sein: "|"',
    ])
    // Self-hosted, both may be missing …
    for (const HOSTED of ['false', '', undefined]) {
      expect(instanceConfigProblems({ HOSTED })).toEqual([])
      expect(instanceConfigProblems({ HOSTED, ...HOSTED_REQUIRED })).toEqual([])
    }
  })

  // … but a value nobody can parse is a typo either way
  test('names a terms version and an operator address it cannot parse', () => {
    const invalid = {
      HOSTED_TERMS_VERSION: 'x'.repeat(65),
      HOSTED_OPERATOR_EMAIL: ' betrieb ',
    }
    const expected = [
      `HOSTED_TERMS_VERSION muss eine Kennung aus höchstens 64 Buchstaben, Ziffern, Punkten, Binde- oder Unterstrichen sein: "${'x'.repeat(65)}"`,
      'HOSTED_OPERATOR_EMAIL muss eine E-Mail-Adresse sein: "betrieb"',
    ]
    expect(
      instanceConfigProblems({ HOSTED: 'true', ...OPERATOR, ...invalid }),
    ).toEqual(expected)
    expect(instanceConfigProblems(invalid)).toEqual(expected)
  })

  // Checked hosted or not, like DOCS_URL: a typo is a typo
  test('names a Plausible domain or address it cannot parse', () => {
    expect(
      instanceConfigProblems({
        PLAUSIBLE_DOMAIN: 'https://kibo.example',
        PLAUSIBLE_URL: 'plausible.io',
      }),
    ).toEqual([
      'PLAUSIBLE_DOMAIN muss ein Domainname sein, wie er in Plausible eingetragen ist: "https://kibo.example"',
      'PLAUSIBLE_URL muss eine Adresse mit http:// oder https:// sein, ohne Zugangsdaten, Query und Fragment: "plausible.io"',
    ])
    expect(
      instanceConfigProblems({
        PLAUSIBLE_DOMAIN: 'kibo.example',
        PLAUSIBLE_URL: 'https://stats.kibo.example',
      }),
    ).toEqual([])
  })

  // Self-hosted, the operator details may be missing (the start-up log says
  // so), but what is there has to be right
  test('names operator details and legal addresses it cannot parse', () => {
    expect(
      instanceConfigProblems({
        OPERATOR_NAME: 'Kita | Träger',
        OPERATOR_ADDRESS: 'www.example.org',
        OPERATOR_EMAIL: 'kontakt',
        OPERATOR_LEGAL_INFO: `Zeile${char(0x202e)}`,
        IMPRESSUM_URL: '/impressum',
        DATENSCHUTZ_URL: 'http://traeger.example/datenschutz',
      }),
    ).toEqual([
      'OPERATOR_NAME muss eine Zeile mit höchstens 120 Zeichen ohne Link sein: "Kita | Träger"',
      'OPERATOR_ADDRESS muss höchstens 5 Zeilen (getrennt durch |) mit je höchstens 100 Zeichen ohne Link sein: "www.example.org"',
      'OPERATOR_EMAIL muss eine E-Mail-Adresse sein: "kontakt"',
      `OPERATOR_LEGAL_INFO muss höchstens 8 Zeilen (getrennt durch |) mit je höchstens 200 Zeichen haben: "Zeile${char(0x202e)}"`,
      'IMPRESSUM_URL muss eine Adresse mit https:// sein: "/impressum"',
      'DATENSCHUTZ_URL muss eine Adresse mit https:// sein: "http://traeger.example/datenschutz"',
    ])
    for (const HOSTED of ['false', '', undefined]) {
      expect(instanceConfigProblems({ HOSTED, ...OPERATOR })).toEqual([])
    }
    // An address that reads differently from how it is stored, hosted or not
    for (const code of [0x7, 0x202e]) {
      const OPERATOR_EMAIL = `kontakt${char(code)}@kibo.example`
      const expected = [
        `OPERATOR_EMAIL muss eine E-Mail-Adresse sein: "${OPERATOR_EMAIL}"`,
      ]
      expect(instanceConfigProblems({ OPERATOR_EMAIL })).toEqual(expected)
      expect(
        instanceConfigProblems({
          HOSTED: 'true',
          ...HOSTED_REQUIRED,
          OPERATOR_EMAIL,
        }),
      ).toEqual(expected)
      expect(
        instanceConfigProblems({
          HOSTED: 'true',
          ...HOSTED_REQUIRED,
          HOSTED_OPERATOR_EMAIL: OPERATOR_EMAIL,
        }),
      ).toEqual([
        `HOSTED_OPERATOR_EMAIL muss eine E-Mail-Adresse sein: "${OPERATOR_EMAIL}"`,
      ])
    }
    expect(
      instanceConfigProblems({
        OPERATOR_LEGAL_INFO: 'HRB 1 | USt-IdNr. DE123',
        IMPRESSUM_URL: 'https://traeger.example/impressum',
        DATENSCHUTZ_URL: ' ',
      }),
    ).toEqual([])
  })

  test('names the value and the entries it cannot parse', () => {
    expect(
      instanceConfigProblems({
        SIGNUP_MODE: ' geschlossen ',
        SIGNUP_EMAIL_DOMAINS: 'kita.de, *, a.de:25',
      }),
    ).toEqual([
      'SIGNUP_MODE muss open oder closed sein: "geschlossen"',
      'SIGNUP_EMAIL_DOMAINS enthält ungültige Einträge: *, a.de:25',
    ])
  })
})
