import { describe, expect, test } from 'bun:test'

import { optionalText, requiredText } from '@/actions/text-fields'
import { assertAccountName } from '@/lib/account-rules'
import { PASSKEY_NAME_MAX } from '@/lib/limits'
import {
  beforeCreateOrganization,
  beforeUpdateOrganization,
} from '@/lib/organization-rules'
import { isOrganizationSlug, organizationSlug } from '@/lib/organization-slug'
import { isValidPasskeyName } from '@/lib/passkeys/rules'
import { normalizeContent } from '@/lib/spam/content'

import { apiRefusal } from './helpers/api-error'

// Written as code points, so nothing invisible hides in this file
const char = (code: number) => String.fromCodePoint(code)
const NUL = char(0)
const ZERO_WIDTH_SPACE = char(0x200b)
const SOFT_HYPHEN = char(0xad)
const RIGHT_TO_LEFT_OVERRIDE = char(0x202e)
const HANGUL_FILLER = char(0x3164)
const COMBINING_ACUTE = char(0x301)
const ZERO_WIDTH_JOINER = char(0x200d)

// The error code a hook turned the attempt away with, undefined if accepted
function refusal(attempt: Promise<unknown>) {
  return attempt.then(
    () => undefined,
    (error: unknown) => apiRefusal(error).code ?? 'ERROR',
  )
}

describe('text fields of the actions', () => {
  const title = requiredText(60)
  const body = requiredText(400, { multiline: true })
  const contact = optionalText(120)

  test('accept what people type, emoji sequences included', () => {
    const family = `${char(0x1f469)}${ZERO_WIDTH_JOINER}${char(0x1f467)}`
    expect(title.parse('  Fahrrad abzugeben ')).toBe('Fahrrad abzugeben')
    expect(title.parse(`Kuchen ${family}`)).toBe(`Kuchen ${family}`)
    expect(body.parse('Zeile 1\nZeile 2\n\tEingerückt')).toBe(
      'Zeile 1\nZeile 2\n\tEingerückt',
    )
  })

  test('reject control characters, line breaks only where they belong', () => {
    expect(title.safeParse(`Hallo${NUL}`).success).toBe(false)
    expect(title.safeParse('Zwei\nZeilen').success).toBe(false)
    expect(body.safeParse(`Text${NUL}mit NUL`).success).toBe(false)
    expect(body.safeParse(`Text${char(0x1b)}[31m`).success).toBe(false)
    expect(title.safeParse(`abc${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`).success).toBe(
      false,
    )
  })

  // Half an emoji on either side of a line break is two lone surrogates, not
  // the emoji they would make without the break
  test('reject lone surrogates around a line break', () => {
    const [high, low] = [char(0xd83d), char(0xde00)]
    expect(body.safeParse(`x${high}\n${low}`).success).toBe(false)
    expect(body.safeParse(`x${high}\r\n${low}`).success).toBe(false)
    expect(body.safeParse(`x${high}\t${low}`).success).toBe(false)
    expect(title.safeParse(`x${high}${low}`).success).toBe(true)
    for (const kept of ['a\nb', 'a\tb', `x${char(0x1f600)}`]) {
      expect(body.parse(kept)).toBe(kept)
    }
  })

  test('treat text made of invisible characters as empty', () => {
    for (const blank of [
      '   ',
      ZERO_WIDTH_SPACE.repeat(3),
      `${SOFT_HYPHEN} ${HANGUL_FILLER}`,
      COMBINING_ACUTE,
    ]) {
      expect(title.safeParse(blank).success).toBe(false)
      expect(contact.parse(blank)).toBe('')
    }
  })

  test('still bound the length', () => {
    expect(title.safeParse('x'.repeat(61)).success).toBe(false)
    expect(contact.safeParse('x'.repeat(121)).success).toBe(false)
  })
})

describe('organization rules', () => {
  const slug = organizationSlug('Kita Sonnenschein')

  test('accept a name and the slug the app generates', async () => {
    const result = await beforeCreateOrganization({
      organization: { name: '  Kita Sonnenschein ', slug },
    })
    expect(result.data.name).toBe('Kita Sonnenschein')
  })

  test('reject names that are empty, too long or not plain text', async () => {
    for (const name of [
      '',
      '   ',
      ZERO_WIDTH_SPACE,
      'x'.repeat(101),
      `Kita${NUL}`,
      'Kita\nSonnenschein',
      42,
    ]) {
      expect(
        await refusal(
          beforeCreateOrganization({ organization: { name, slug } }),
        ),
      ).toBe('INVALID_ORGANIZATION_NAME')
    }
  })

  // The name ends up in invitation mails to addresses of the owner's choosing
  test('reject names that read like a link, new and changed', async () => {
    for (const name of [
      'Gewinn abholen: www.evil.example',
      'https://evil.example',
      'Kita HTTP://evil.example',
    ]) {
      expect(
        await refusal(
          beforeCreateOrganization({ organization: { name, slug } }),
        ),
      ).toBe('ORGANIZATION_NAME_LOOKS_LIKE_LINK')
      expect(
        await refusal(beforeUpdateOrganization({ organization: { name } })),
      ).toBe('ORGANIZATION_NAME_LOOKS_LIKE_LINK')
    }
  })

  test('reject slugs the app would never generate', async () => {
    for (const bad of [
      '',
      'Gross',
      'mit leerzeichen',
      '-vorne',
      'a--b',
      'x'.repeat(48),
    ]) {
      const attempt = beforeCreateOrganization({
        organization: { name: 'Kita', slug: bad },
      })
      expect(await refusal(attempt)).toBe('INVALID_ORGANIZATION_SLUG')
    }
  })

  test('reject a logo or metadata', async () => {
    const logo = 'https://evil.example/x.png'
    expect(
      await refusal(
        beforeCreateOrganization({
          organization: { name: 'Kita', slug, logo },
        }),
      ),
    ).toBe('INVALID_ORGANIZATION')
    expect(
      await refusal(
        beforeUpdateOrganization({ organization: { metadata: { a: 1 } } }),
      ),
    ).toBe('INVALID_ORGANIZATION')
  })

  test('check on update only what is sent', async () => {
    expect(
      await beforeUpdateOrganization({ organization: { slug } }),
    ).toBeUndefined()
    const renamed = await beforeUpdateOrganization({
      organization: { name: ' Kita Regenbogen ' },
    })
    expect(renamed?.data.name).toBe('Kita Regenbogen')
    expect(
      await refusal(beforeUpdateOrganization({ organization: { name: ' ' } })),
    ).toBe('INVALID_ORGANIZATION_NAME')
  })
})

describe('organizationSlug', () => {
  test('always produces a slug the rules accept', () => {
    for (const name of [
      'Kita Sonnenschein',
      'Äpfel & Öl – Straße',
      '!!!',
      `${'a'.repeat(39)} b`,
      'x'.repeat(200),
    ]) {
      expect(isOrganizationSlug(organizationSlug(name))).toBe(true)
    }
  })
})

describe('account names', () => {
  test('accept a normal name', () => {
    expect(() => assertAccountName('Anna Schmidt-Özdemir')).not.toThrow()
  })

  test('reject what would put arbitrary text into a mail', () => {
    for (const name of [
      '',
      ZERO_WIDTH_SPACE,
      'x'.repeat(81),
      'Anna\nBitte hier klicken',
      `Anna${NUL}`,
      'https://evil.example',
      'Gewinn auf www.evil.example',
      undefined,
    ]) {
      expect(() => assertAccountName(name)).toThrow()
    }
  })
})

// The name a person gives a passkey on the account page
describe('passkey names', () => {
  test('accept one visible line of at most the maximum', () => {
    expect(isValidPasskeyName('Laptop im Büro')).toBe(true)
    expect(isValidPasskeyName('x'.repeat(PASSKEY_NAME_MAX))).toBe(true)
  })

  test('reject what is too long, invisible, more than a line or no text', () => {
    for (const name of [
      'x'.repeat(PASSKEY_NAME_MAX + 1),
      '',
      ZERO_WIDTH_SPACE,
      'Zeile\nZeile',
      `Laptop${RIGHT_TO_LEFT_OVERRIDE}`,
      `Laptop${NUL}`,
      undefined,
      ['Laptop'],
    ]) {
      expect(isValidPasskeyName(name)).toBe(false)
    }
  })
})

describe('normalizeContent', () => {
  const base = normalizeContent(['Fahrrad abzugeben', 'Läuft noch prima'])

  test('sees through invisible characters and accents', () => {
    expect(
      normalizeContent([
        `Fahr${ZERO_WIDTH_SPACE}rad ab${SOFT_HYPHEN}zugeben`,
        `La${COMBINING_ACUTE}uft noch${NUL} prima`,
      ]),
    ).toBe(base)
    expect(normalizeContent(['FAHRRAD abzugeben!', 'Lauft noch prima'])).toBe(
      base,
    )
  })

  test('keeps title and body apart', () => {
    expect(normalizeContent(['Fahrrad', 'abzugeben'])).not.toBe(
      normalizeContent(['Fahrrad abzugeben', '']),
    )
  })

  test('is empty when nothing is left to compare', () => {
    expect(normalizeContent(['!!!', ZERO_WIDTH_SPACE])).toBe('')
  })
})
