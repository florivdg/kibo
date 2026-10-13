import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'

import { instanceMode, operatorDetails } from '@/lib/instance'
import { legalPages, legalSources } from '@/lib/legal'
import { INVITATION_TTL_DAYS } from '@/lib/limits'
import { logOperatorConfiguration } from '@/lib/mail/footer'
import {
  deletionNoticeMail,
  emailChangeConfirmationMail,
  invitationMail,
  invoiceRequestConfirmationMail,
  invoiceRequestOperatorMail,
  newEmailVerificationMail,
  noteReportMail,
  passwordResetMail,
  subscriptionEndingMail,
  subscriptionExpiredMail,
  subscriptionPausedMail,
  verificationMail,
} from '@/lib/mail/templates'

// The footer every mail ends with and the privacy notice of an invitation
// (src/lib/mail/footer.ts, rendered by src/lib/mail/templates.ts). The
// settings are the objects the app reads, changed in place and put back.
// BETTER_AUTH_URL is http://localhost:4321 in the tests (tests/preload.ts).
const SITE = 'http://localhost:4321'
const original = {
  operator: structuredClone(operatorDetails),
  hosted: instanceMode.hosted,
  impressum: legalPages.impressum.url,
  datenschutz: legalPages.datenschutz.url,
  directory: legalSources.directory,
}

afterEach(() => {
  Object.assign(operatorDetails, structuredClone(original.operator))
  instanceMode.hosted = original.hosted
  legalPages.impressum.url = original.impressum
  legalPages.datenschutz.url = original.datenschutz
  legalSources.directory = original.directory
})

function setOperator() {
  Object.assign(operatorDetails, {
    name: 'Kibo Betrieb GmbH',
    address: ['Musterstraße 1', '12345 Musterstadt'],
    email: 'kontakt@kibo.example',
    legalInfo: [
      'Amtsgericht Musterstadt, HRB 12345',
      'Geschäftsführung: Anna Beispiel',
    ],
  })
}

const url = 'https://kibo.example/link'
const details = [{ label: 'Rechnungsempfänger', value: 'Kita Sonnenschein' }]

// Every template there is: the five of the sign-in, the report notice and
// the six of the hosted instance
const ALL_MAILS = {
  verification: () => verificationMail('Anna', url),
  passwordReset: () => passwordResetMail('Anna', url),
  emailChangeConfirmation: () =>
    emailChangeConfirmationMail('Anna', 'neu@example.org', url),
  newEmailVerification: () => newEmailVerificationMail('Anna', url),
  invitation: () =>
    invitationMail({
      organizationName: 'Kita Sonnenschein',
      inviterName: 'Anna Beispiel',
      url,
    }),
  noteReport: () =>
    noteReportMail('Anna', {
      organizationName: 'Kita Sonnenschein',
      count: 2,
      url,
    }),
  subscriptionEnding: () =>
    subscriptionEndingMail('Anna', {
      ended: 'trial',
      lastDay: '1. Oktober 2026',
      url,
    }),
  subscriptionExpired: () =>
    subscriptionExpiredMail('Anna', {
      ended: 'subscription',
      lastDay: '1. Oktober 2026',
      pausesOn: '15. Oktober 2026',
      url,
    }),
  subscriptionPaused: () =>
    subscriptionPausedMail('Anna', { deletableOn: '1. Januar 2027', url }),
  deletionNotice: () =>
    deletionNoticeMail('Anna', { deletesOn: '1. Januar 2027', url }),
  invoiceRequestOperator: () =>
    invoiceRequestOperatorMail('owner@example.org', details),
  invoiceRequestConfirmation: () => invoiceRequestConfirmationMail(details),
}

describe('the footer of every mail', () => {
  test('names the operator and links imprint and privacy policy, in both versions', () => {
    setOperator()
    for (const [kind, render] of Object.entries(ALL_MAILS)) {
      const { text, html } = render()
      expect({
        kind,
        ends: text.endsWith(
          [
            'Viele Grüße\nIhr Kibo-Team',
            '',
            '-- ',
            'Kibo Betrieb GmbH\nMusterstraße 1\n12345 Musterstadt\nE-Mail: kontakt@kibo.example',
            '',
            'Amtsgericht Musterstadt, HRB 12345\nGeschäftsführung: Anna Beispiel',
            '',
            `Impressum: ${SITE}/impressum\nDatenschutz: ${SITE}/datenschutz`,
          ].join('\n'),
        ),
      }).toEqual({ kind, ends: true })
      expect(html).toContain(
        'Kibo Betrieb GmbH<br />Musterstraße 1<br />12345 Musterstadt<br />E-Mail: kontakt@kibo.example',
      )
      expect(html).toContain(
        'Amtsgericht Musterstadt, HRB 12345<br />Geschäftsführung: Anna Beispiel',
      )
      expect(html).toContain(`<a href="${SITE}/impressum"`)
      expect(html).toContain(`<a href="${SITE}/datenschutz"`)
      // Below the card, after the signature
      expect(html.indexOf('Ihr Kibo-Team')).toBeLessThan(
        html.indexOf('Musterstraße 1'),
      )
    }
  })

  test('escapes everything that is configured', () => {
    Object.assign(operatorDetails, {
      name: 'Müller & Söhne <Träger> "gGmbH"',
      address: ['<script>alert(1)</script>'],
      email: 'a"b@kibo.example',
      legalInfo: ['HRB <12345> & Co'],
    })
    legalPages.impressum.url = 'https://traeger.example/impressum?a=1&b=2'
    const { text, html } = verificationMail('Anna', url)
    expect(html).toContain(
      'Müller &amp; Söhne &lt;Träger&gt; &quot;gGmbH&quot;',
    )
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('E-Mail: a&quot;b@kibo.example')
    expect(html).toContain('HRB &lt;12345&gt; &amp; Co')
    expect(html).toContain(
      'href="https://traeger.example/impressum?a=1&amp;b=2"',
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<Träger>')
    // The plain-text version says it as it is
    expect(text).toContain('Müller & Söhne <Träger> "gGmbH"')
    expect(text).toContain(
      'Impressum: https://traeger.example/impressum?a=1&b=2',
    )
  })

  test('shows only what is set, and always the two links', () => {
    const { text, html } = passwordResetMail('Anna', url)
    expect(
      text.endsWith(
        `Ihr Kibo-Team\n\n-- \nImpressum: ${SITE}/impressum\nDatenschutz: ${SITE}/datenschutz`,
      ),
    ).toBe(true)
    expect(html).not.toContain('E-Mail:')
    expect(html).toContain(`<a href="${SITE}/impressum"`)

    operatorDetails.email = 'kontakt@kibo.example'
    expect(passwordResetMail('Anna', url).text).toContain(
      `-- \nE-Mail: kontakt@kibo.example\n\nImpressum: ${SITE}/impressum`,
    )
  })
})

describe('the links to imprint and privacy policy', () => {
  test('lead to the operator’s own pages when they are set', () => {
    legalPages.impressum.url = 'https://traeger.example/impressum'
    legalPages.datenschutz.url = ' https://traeger.example/datenschutz '
    const { text, html } = verificationMail('Anna', url)
    expect(text).toContain(
      'Impressum: https://traeger.example/impressum\nDatenschutz: https://traeger.example/datenschutz',
    )
    expect(html).toContain('<a href="https://traeger.example/datenschutz"')
    expect(html).not.toContain(`${SITE}/impressum`)
  })

  // Absolute, under BETTER_AUTH_URL: the pages answer without a session
  test('lead to the instance’s own pages otherwise, one at a time', () => {
    legalPages.datenschutz.url = 'https://traeger.example/datenschutz'
    const { text } = verificationMail('Anna', url)
    expect(text).toContain(
      `Impressum: ${SITE}/impressum\nDatenschutz: https://traeger.example/datenschutz`,
    )
    legalPages.impressum.url = ''
    legalPages.datenschutz.url = undefined
    expect(verificationMail('Anna', url).text).toContain(
      `Impressum: ${SITE}/impressum\nDatenschutz: ${SITE}/datenschutz`,
    )
  })

  // As the start-up check reads them (parseLegalUrl): what the check
  // accepted is what the mail links, never the value as it was typed
  test('carry the normalised address, not the one as typed', () => {
    legalPages.datenschutz.url = 'https:example.com/privacy'
    legalPages.impressum.url = 'https://traeger.example/rechtliches impressum'
    const { text, html } = verificationMail('Anna', url)
    expect(text).toContain(
      'Impressum: https://traeger.example/rechtliches%20impressum\nDatenschutz: https://example.com/privacy',
    )
    expect(html).toContain('<a href="https://example.com/privacy"')
    expect(html).toContain(
      '<a href="https://traeger.example/rechtliches%20impressum"',
    )
    expect(html).not.toContain('https:example.com')
    expect(html).not.toContain('rechtliches impressum')
  })

  // Only the dev server gets that far: the server doesn't start with it
  test('fall back to the instance’s own pages for an address the check rejects', () => {
    legalPages.impressum.url = 'http://traeger.example/impressum'
    legalPages.datenschutz.url = 'kein Link'
    expect(verificationMail('Anna', url).text).toContain(
      `Impressum: ${SITE}/impressum\nDatenschutz: ${SITE}/datenschutz`,
    )
  })
})

describe('the privacy notice of an invitation', () => {
  const invite = () =>
    invitationMail({
      organizationName: 'Kita <Sonnenschein>',
      inviterName: 'Anna Beispiel',
      url,
    })

  // The hosted instance processes on the Kita's behalf, under the data
  // processing agreement every account agrees to
  test('names who is responsible, where the address came from, how long it is kept and whom to write to', () => {
    setOperator()
    instanceMode.hosted = true
    const { text, html } = invite()
    const notice = text.slice(text.indexOf('Datenschutzhinweis:'))
    expect(notice).toStartWith(
      'Datenschutzhinweis: Ihre E-Mail-Adresse hat die Inhaberin oder der Inhaber der Kita „Kita <Sonnenschein>“ eingegeben, um Sie zur Verwaltung der Kita einzuladen.',
    )
    expect(notice).toContain(
      'Verantwortlich für diese Einladung ist die Kita „Kita <Sonnenschein>“; Kibo Betrieb GmbH, der Betreiber dieser Kibo-Instanz, verarbeitet Ihre Adresse dafür in ihrem Auftrag.',
    )
    expect(notice).toContain(
      `nach ${INVITATION_TTL_DAYS} Tagen abläuft; danach wird sie beim nächsten stündlichen Aufräumen gelöscht.`,
    )
    expect(notice).toContain(
      'Ist Ihnen die Einladung unerwünscht, schreiben Sie an kontakt@kibo.example.',
    )
    expect(notice).toContain(
      `Ausführliche Informationen nach Art. 14 DSGVO stehen in der Datenschutzerklärung:\n${SITE}/datenschutz\n\nViele Grüße`,
    )
    // After the link and its validity, before the signature
    expect(text.indexOf('Der Link ist')).toBeLessThan(
      text.indexOf('Datenschutzhinweis'),
    )
    expect(html).toContain('<strong>Datenschutzhinweis</strong>')
    expect(html).toContain('der Kita „Kita &lt;Sonnenschein&gt;“ eingegeben')
    expect(html).toContain(
      `<a href="${SITE}/datenschutz" style="color:#52525b">${SITE}/datenschutz</a>`,
    )
    expect(html).not.toContain('<Sonnenschein>')
  })

  // Self-hosted there is no such agreement, and the operator may well be
  // responsible itself: the notice names it as the one to turn to and leaves
  // the legal relationship to the privacy policy
  test('names the operator as the contact on a self-hosted instance', () => {
    setOperator()
    instanceMode.hosted = false
    const { text, html } = invite()
    const notice = text.slice(text.indexOf('Datenschutzhinweis:'))
    expect(notice).toStartWith(
      'Datenschutzhinweis: Ihre E-Mail-Adresse hat die Inhaberin oder der Inhaber der Kita „Kita <Sonnenschein>“ eingegeben, um Sie zur Verwaltung der Kita einzuladen. Ansprechpartner für den Datenschutz ist Kibo Betrieb GmbH, der Betreiber dieser Kibo-Instanz. Die Einladung',
    )
    expect(notice).not.toContain('Verantwortlich')
    expect(notice).not.toContain('Auftrag')
    expect(notice).toContain(
      `nach ${INVITATION_TTL_DAYS} Tagen abläuft; danach wird sie beim nächsten stündlichen Aufräumen gelöscht.`,
    )
    expect(notice).toContain(
      'Ist Ihnen die Einladung unerwünscht, schreiben Sie an kontakt@kibo.example.',
    )
    expect(notice).toContain(
      `Ausführliche Informationen nach Art. 14 DSGVO stehen in der Datenschutzerklärung:\n${SITE}/datenschutz\n\nViele Grüße`,
    )
    expect(html).toContain(
      'Ansprechpartner für den Datenschutz ist Kibo Betrieb GmbH, der Betreiber dieser Kibo-Instanz.',
    )
    expect(html).not.toContain('in ihrem Auftrag')
  })

  test('gets by without the operator’s name and address', () => {
    legalPages.datenschutz.url = 'https://traeger.example/datenschutz'
    instanceMode.hosted = true
    const { text } = invite()
    expect(text).toContain(
      '; der Betreiber dieser Kibo-Instanz verarbeitet Ihre Adresse dafür in ihrem Auftrag.',
    )
    instanceMode.hosted = false
    expect(invite().text).toContain(
      ' Ansprechpartner für den Datenschutz ist der Betreiber dieser Kibo-Instanz. ',
    )
    expect(text).toContain(
      'Ist Ihnen die Einladung unerwünscht, wenden Sie sich an den Betreiber; wie Sie ihn erreichen, steht im Impressum.',
    )
    expect(text).toContain(
      'in der Datenschutzerklärung:\nhttps://traeger.example/datenschutz',
    )
  })

  test('is in no other mail', () => {
    setOperator()
    for (const [kind, render] of Object.entries(ALL_MAILS)) {
      if (kind === 'invitation') continue
      expect(render().text).not.toContain('Datenschutzhinweis')
    }
  })
})

describe('logOperatorConfiguration', () => {
  // Imprint and privacy policy as files, so only the operator details count
  const filledIn = mkdtempSync(join(tmpdir(), 'kibo-legal-'))
  writeFileSync(join(filledIn, 'impressum.md'), '# Impressum\n')
  writeFileSync(join(filledIn, 'datenschutz.md'), '# Datenschutz\n')
  const empty = mkdtempSync(join(tmpdir(), 'kibo-legal-'))
  afterAll(() => {
    rmSync(filledIn, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  })

  function capture(run: () => void) {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const info = spyOn(console, 'info').mockImplementation(() => {})
    try {
      run()
      return {
        warned: warn.mock.calls.map((call) => String(call[0])),
        informed: info.mock.calls.map((call) => String(call[0])),
      }
    } finally {
      warn.mockRestore()
      info.mockRestore()
    }
  }

  test('warns about what is missing, once', () => {
    legalSources.directory = filledIn
    operatorDetails.name = 'Kibo Betrieb GmbH'
    expect(capture(logOperatorConfiguration)).toEqual({
      warned: [
        '[mail] Betreiberangaben unvollständig, es fehlt: OPERATOR_ADDRESS, OPERATOR_EMAIL. Der Fuß der E-Mails nennt nur, was gesetzt ist, und verlinkt Impressum und Datenschutz.',
      ],
      informed: [],
    })

    setOperator()
    expect(capture(logOperatorConfiguration)).toEqual({
      warned: [],
      informed: ['[mail] Betreiber im Fuß der E-Mails: Kibo Betrieb GmbH'],
    })
  })

  // Every mail links both; without an address or a file the links lead to a
  // page that only says it isn't filled in
  test('warns about an imprint or a privacy policy nobody filled in', () => {
    setOperator()
    legalSources.directory = empty
    legalPages.impressum.url = undefined
    legalPages.datenschutz.url = ' '
    const warning = (page: string) =>
      `[legal] Für /${page} ist weder ${page.toUpperCase()}_URL gesetzt noch ${page}.md in LEGAL_DIR (${empty}) hinterlegt. Die Seite und der Link im Fuß jeder E-Mail zeigen nur einen Hinweis.`
    expect(capture(logOperatorConfiguration).warned).toEqual([
      warning('impressum'),
      warning('datenschutz'),
    ])

    // An address of the operator's own, or a file, is enough
    legalPages.datenschutz.url = 'https://traeger.example/datenschutz'
    expect(capture(logOperatorConfiguration).warned).toEqual([
      warning('impressum'),
    ])
    writeFileSync(join(empty, 'impressum.md'), '# Impressum\n')
    expect(capture(logOperatorConfiguration).warned).toEqual([])
  })
})
