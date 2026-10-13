import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { HOSTED_PRICING_DEFAULTS } from '../scripts/instance-config.mjs'

import {
  HOSTED_DELETION_DAYS,
  HOSTED_DELETION_NOTICE_DAYS,
  HOSTED_GRACE_DAYS,
  HOSTED_ORGANIZATION_CAP,
  MEMBERSHIP_LIMIT,
} from '@/lib/limits'
import {
  author,
  faqEntries,
  hostedStartPage,
  howItWorks,
  jsonLd,
  launchFilm,
  pricingFacts,
  pricingTerms,
  serviceFilm,
  serviceSummary,
  structuredData,
  trustPoints,
  trustPointsFor,
} from '@/lib/marketing/hosted-page'

// What the start page of the hosted instance says
// (src/lib/marketing/hosted-page.ts): the numbers are the configuration's,
// and the text a visitor reads is the text a search engine gets.
const DEFAULTS = { ...HOSTED_PRICING_DEFAULTS }
const FACTS = pricingFacts(DEFAULTS)

// Everything a set of facts says, in one string
const said = (value: unknown) => JSON.stringify(value)

describe('pricingFacts', () => {
  test('states the configured plan', () => {
    expect(FACTS).toEqual({
      ...DEFAULTS,
      included: 'inkl. 3 Kitas',
      extra: 'jede weitere Kita 10 € im Jahr',
      trial: '30 Tage kostenlos',
      summary: '49 € im Jahr inkl. 3 Kitas, jede weitere Kita 10 € im Jahr',
    })
    expect(pricingTerms).toEqual([
      'Ein Jahr im Voraus, auf Rechnung',
      'Keine automatische Verlängerung',
      'Hört ihr vor Ende des bezahlten Jahres auf, gibt es kein Geld anteilig zurück',
      'Für die Testphase braucht ihr keine Zahlungsdaten',
      'Das Angebot richtet sich an Kitas und Träger',
    ])
  })

  test('takes every number from the configuration', () => {
    const facts = pricingFacts({
      priceEur: 120,
      includedKitas: 5,
      extraKitaEur: 15,
      trialDays: 14,
    })
    expect(facts.summary).toMatch(/^120 € im Jahr /)
    expect(facts.included).toBe('inkl. 5 Kitas')
    expect(facts.extra).toBe('jede weitere Kita 15 € im Jahr')
    expect(facts.trial).toBe('14 Tage kostenlos')
    expect(said(facts)).not.toMatch(/49|\b3 Kitas|\b10 €|30 Tage/)
  })

  test('knows one Kita and one day from several', () => {
    const facts = pricingFacts({ ...DEFAULTS, includedKitas: 1, trialDays: 1 })
    expect(facts.included).toBe('inkl. 1 Kita')
    expect(facts.trial).toBe('1 Tag kostenlos')
  })

  test('says so when further Kitas cost nothing', () => {
    const facts = pricingFacts({ ...DEFAULTS, extraKitaEur: 0 })
    expect(facts.extra).toBe('weitere Kitas ohne Aufpreis')
    expect(said(facts)).not.toContain('0 €')
  })

  // Then the price is the account's, and every Kita is a further one
  test('includes nothing when the price includes no Kita', () => {
    const facts = pricingFacts({ ...DEFAULTS, includedKitas: 0 })
    expect(facts.included).toBe('für das Konto')
    expect(facts.extra).toBe('jede Kita 10 € im Jahr')
    expect(said(facts)).not.toMatch(/inkl\.|0 Kitas|weitere/)

    const free = pricingFacts({
      ...DEFAULTS,
      includedKitas: 0,
      extraKitaEur: 0,
    })
    expect(free.extra).toBe('Kitas ohne Aufpreis')
  })

  // What the operator owes in VAT is theirs to say (HOSTED_PRICE_NOTE, a
  // line of its own below the price)
  test('says nothing about VAT', () => {
    expect(
      said([hostedStartPage(DEFAULTS, true), pricingTerms, trustPoints]),
    ).not.toMatch(/steuer|\bust\b|mwst/i)
  })
})

describe('serviceSummary', () => {
  const summary = (pricing = DEFAULTS, open = true) =>
    serviceSummary(pricingFacts(pricing), open)

  test('names trial and price for the page’s description', () => {
    expect(summary()).toBe(
      '30 Tage kostenlos testen, danach 49 € im Jahr für bis zu 3 Kitas.',
    )
    expect(summary({ ...DEFAULTS, includedKitas: 1, trialDays: 1 })).toBe(
      '1 Tag kostenlos testen, danach 49 € im Jahr für bis zu 1 Kita.',
    )
    expect(summary({ ...DEFAULTS, includedKitas: 0 })).toBe(
      '30 Tage kostenlos testen, danach 49 € im Jahr für das Konto, jede Kita 10 € im Jahr.',
    )
  })

  // About 160 characters are shown, and the sentence about the product
  // (`productLead` in src/pages/index.astro) takes the rest
  test('leaves a search engine room for the sentence before it', () => {
    expect(summary().length).toBeLessThanOrEqual(75)
  })

  test('names the price alone where nobody can sign up', () => {
    expect(summary(DEFAULTS, false)).toBe('49 € im Jahr für bis zu 3 Kitas.')
    expect(summary({ ...DEFAULTS, includedKitas: 0 }, false)).toBe(
      '49 € im Jahr für das Konto, jede Kita 10 € im Jahr.',
    )
  })
})

describe('hostedStartPage', () => {
  test('is everything the page says, made from one set of facts', () => {
    expect(hostedStartPage(DEFAULTS, true)).toEqual({
      facts: FACTS,
      cta: '30 Tage kostenlos testen',
      summary: serviceSummary(FACTS, true),
      steps: howItWorks(DEFAULTS, true),
      faq: faqEntries(FACTS, true),
    })
    expect(hostedStartPage({ ...DEFAULTS, trialDays: 1 }, true).cta).toBe(
      '1 Tag kostenlos testen',
    )
  })

  // With a closed sign-up there is no way in from this page: neither the
  // button nor title and description, which are made from `cta` and
  // `summary`, send anyone to a trial
  test('does not advertise a trial nobody can start', () => {
    const page = hostedStartPage(DEFAULTS, false)
    expect(page.cta).toBeUndefined()
    expect(page.summary).not.toMatch(/testen|kostenlos|Tage/)
    expect(page.steps).toEqual(howItWorks(DEFAULTS, false))
    expect(page.faq).toEqual(faqEntries(FACTS, false))
  })
})

describe('howItWorks', () => {
  test('leads from the sign-up to the invoice in five steps', () => {
    const steps = howItWorks(DEFAULTS, true)
    expect(steps.map((step) => step.title)).toEqual([
      'Registrieren',
      'Kita anlegen',
      'Bretter teilen',
      '30 Tage testen',
      'Rechnung anfordern',
    ])
    expect(steps.every((step) => step.body.trim() !== '')).toBe(true)
    expect(howItWorks({ ...DEFAULTS, trialDays: 1 }, true)[3]?.title).toBe(
      '1 Tag testen',
    )
  })

  test('does not tell anyone to sign up where nobody can', () => {
    const steps = howItWorks(DEFAULTS, false)
    expect(steps).toHaveLength(5)
    expect(steps[0]?.title).toBe('Konto bekommen')
    expect(said(steps)).not.toMatch(/registriert euch|Registrieren/)
  })
})

describe('trustPoints', () => {
  test('link the data processing agreement and the privacy policy', () => {
    expect(trustPoints.map((point) => point.title)).toEqual([
      'Keine Werbung',
      'Kein Tracking',
      'Keine Konten für Eltern',
      'Zettel laufen von selbst ab',
      'AV-Vertrag',
      'Datenschutzerklärung',
    ])
    expect(
      trustPoints.flatMap((point) => (point.link ? [point.link.page] : [])),
    ).toEqual(['avv', 'datenschutz'])
    expect(said(trustPoints)).toContain('7, 14 oder 30 Tage')
  })

  // „Kein Tracking“ is only true while the start page counts nothing
  // (PLAUSIBLE_DOMAIN on the hosted instance)
  test('say so when the start page counts its page views', () => {
    expect(trustPointsFor(false)).toBe(trustPoints)
    const counting = trustPointsFor(true)
    expect(counting.map((point) => point.title)).toEqual([
      'Keine Werbung',
      'Kein Tracking auf den Brettern',
      'Keine Konten für Eltern',
      'Zettel laufen von selbst ab',
      'AV-Vertrag',
      'Datenschutzerklärung',
    ])
    expect(said(counting)).toContain(
      'Nur die Aufrufe dieser Startseite meldet Kibos Server an Plausible',
    )
    expect(said(counting)).toContain('Global Privacy Control')
    // Counted on the server: the page still loads no analytics script
    expect(said(counting)).toContain('keine Analyse-Skripte')
  })

  // Nothing the code can't vouch for: where the instance runs, who runs it
  // and how well is the operator's to say
  test('promise nothing about the operation', () => {
    const everything = said([
      trustPoints,
      trustPointsFor(true),
      pricingTerms,
      hostedStartPage(DEFAULTS, true),
      hostedStartPage(DEFAULTS, false),
    ])
    expect(everything).not.toMatch(
      /Deutschland|\bEU\b|Server in|Rechenzentr|ISO|zertifiz|Verfügbarkeit|Support|GmbH|Kunden|Board/i,
    )
  })
})

describe('faqEntries', () => {
  const questions = (open: boolean) =>
    faqEntries(FACTS, open).map((entry) => entry.question)

  test('answer what a Kita asks before it signs up', () => {
    expect(questions(true)).toEqual([
      'Brauchen Eltern ein Konto?',
      'Wie fangen wir an?',
      'Was passiert nach der Testphase?',
      'Wie bezahlen wir?',
      'Müssen wir kündigen? Was passiert, wenn wir nicht verlängern?',
      'Wir sind ein Träger mit mehreren Kitas. Geht das?',
      'Können mehrere Personen eine Kita verwalten?',
      'Was passiert mit unseren Daten?',
      'Können wir Kibo auch selbst betreiben?',
    ])
    for (const { question, answer } of faqEntries(FACTS, true)) {
      expect(question.trim()).not.toBe('')
      expect(answer.trim()).not.toBe('')
      // Plain text: the structured data carries the same string
      expect(answer).not.toMatch(/[<>]/)
    }
  })

  test('leave out how to start where the sign-up is closed', () => {
    expect(questions(false)).toEqual(
      questions(true).filter((question) => question !== 'Wie fangen wir an?'),
    )
    expect(said(faqEntries(FACTS, false))).not.toContain('registriert euch')
  })

  // What the code does once a trial or a paid year is over: the grace period
  // takes no new Kita (kitaCreationVerdict), the hourly run removes expired
  // notes whatever the subscription says (purgeExpiredNotes), and a deleted
  // Kita doesn't come back with a payment (deleteKitasOf)
  test('promise no more about the end than the code keeps', () => {
    const entries = faqEntries(FACTS, true)
    const answer = (question: string) =>
      entries.find((entry) => entry.question === question)?.answer ?? ''
    const afterTheEnd =
      `Danach funktionieren eure Bretter noch ${HOSTED_GRACE_DAYS} Tage weiter, neue Kitas lassen sich nicht mehr anlegen. ` +
      'Ohne bezahltes Abo werden die Bretter dann pausiert: Eltern können sie nicht mehr öffnen. ' +
      'Bretter und Zettel bleiben gespeichert, Zettel laufen aber wie gewohnt ab. ' +
      `Frühestens ${HOSTED_DELETION_DAYS} Tage nach dem Ablauf werden die Kitas des Kontos gelöscht; ` +
      `das kündigt Kibo ${HOSTED_DELETION_NOTICE_DAYS} Tage vorher per E-Mail an. ` +
      'Bis dahin geht es unter denselben Links weiter, sobald das Abo bezahlt ist.'
    for (const question of [
      'Was passiert nach der Testphase?',
      'Müssen wir kündigen? Was passiert, wenn wir nicht verlängern?',
    ]) {
      expect(answer(question).endsWith(` ${afterTheEnd}`)).toBe(true)
    }
    expect(answer('Was passiert mit unseren Daten?')).toContain(
      'bleiben Kitas und Bretter zunächst gespeichert, Zettel laufen weiter wie gewohnt ab.',
    )
    expect(
      said([entries, faqEntries(FACTS, false), trustPoints, pricingTerms]),
    ).not.toMatch(
      /alles weiter|gespeichert bleibt alles|bleiben die Daten|Sobald das Abo bezahlt ist, geht/,
    )
  })

  // AGB § 5 Abs. 6, said before anyone pays: leaving early refunds nothing
  test('say that leaving early refunds nothing', () => {
    const answer =
      faqEntries(FACTS, true).find(
        (entry) =>
          entry.question ===
          'Müssen wir kündigen? Was passiert, wenn wir nicht verlängern?',
      )?.answer ?? ''
    expect(answer).toContain(
      'Hört ihr vor Ende eines bezahlten Jahres auf, etwa indem ihr euer Konto löscht oder zu einem anderen Anbieter wechselt, bekommt ihr den bezahlten Betrag nicht anteilig zurück.',
    )
  })

  test('take their numbers from the configuration and the limits', () => {
    const answers = (pricing = DEFAULTS) =>
      Object.fromEntries(
        faqEntries(pricingFacts(pricing), true).map((entry) => [
          entry.question,
          entry.answer,
        ]),
      )
    const standard = answers()
    expect(standard['Wie fangen wir an?']).toContain('30 Tage kostenlos')
    expect(standard['Was passiert nach der Testphase?']).toContain(
      `noch ${HOSTED_GRACE_DAYS} Tage`,
    )
    expect(standard['Was passiert mit unseren Daten?']).toContain(
      `Frühestens ${HOSTED_DELETION_DAYS} Tage nach dem Ablauf`,
    )
    expect(standard['Wir sind ein Träger mit mehreren Kitas. Geht das?']).toBe(
      `Ja. Abgerechnet wird das Konto, nicht die einzelne Kita: 49 € im Jahr inkl. 3 Kitas, jede weitere Kita 10 € im Jahr. In der Testphase legt ihr eine Kita an, mit bezahltem Abo bis zu ${HOSTED_ORGANIZATION_CAP} pro Konto.`,
    )
    expect(standard['Können mehrere Personen eine Kita verwalten?']).toContain(
      `bis zu ${MEMBERSHIP_LIMIT} Personen`,
    )

    const other = answers({
      priceEur: 120,
      includedKitas: 1,
      extraKitaEur: 0,
      trialDays: 1,
    })
    expect(other['Wie fangen wir an?']).toContain('1 Tag kostenlos')
    expect(
      other['Wir sind ein Träger mit mehreren Kitas. Geht das?'],
    ).toContain('120 € im Jahr inkl. 1 Kita, weitere Kitas ohne Aufpreis.')
  })
})

describe('structuredData', () => {
  const absolute = (path: string) => new URL(path, 'https://kibo.example').href
  const page = {
    absolute,
    description: 'Das Brett',
    film: { ...launchFilm, description: 'Das Video' },
  }

  // Without HOSTED the start page says what it has always said, key for key
  // and in this order: the output is compared byte for byte with a release
  test('is the product and the video on every other instance', () => {
    const data = structuredData(page)
    expect(data).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Kibo',
        url: 'https://kibo.example/',
        description: 'Das Brett',
        image: 'https://kibo.example/og-image.jpg',
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Web',
        inLanguage: 'de',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: 'Kibo – das digitale Brett für eure Kita',
        description: 'Das Video',
        thumbnailUrl: 'https://kibo.example/video/kibo-launch-poster.webp',
        contentUrl: 'https://kibo.example/video/kibo-launch.mp4',
        uploadDate: '2026-09-29',
        duration: 'PT20S',
        inLanguage: 'de',
      },
    ])
    expect(jsonLd(data)).toBe(
      '[{"@context":"https://schema.org","@type":"WebApplication","name":"Kibo","url":"https://kibo.example/","description":"Das Brett","image":"https://kibo.example/og-image.jpg","applicationCategory":"CommunicationApplication","operatingSystem":"Web","inLanguage":"de"},' +
        '{"@context":"https://schema.org","@type":"VideoObject","name":"Kibo – das digitale Brett für eure Kita","description":"Das Video","thumbnailUrl":"https://kibo.example/video/kibo-launch-poster.webp","contentUrl":"https://kibo.example/video/kibo-launch.mp4","uploadDate":"2026-09-29","duration":"PT20S","inLanguage":"de"}]',
    )
  })

  test('adds the price as an offer in euros on the hosted instance', () => {
    const [application, video] = structuredData({
      ...page,
      hosted: { facts: FACTS, faq: [] },
    })
    expect(application).toMatchObject({
      '@type': 'WebApplication',
      offers: {
        '@type': 'Offer',
        price: '49',
        priceCurrency: 'EUR',
        description:
          'Jahrespreis für ein Konto, inkl. 3 Kitas; jede weitere Kita 10 € im Jahr',
      },
    })
    expect(Object.keys(application ?? {}).at(-1)).toBe('offers')
    // Who wrote it, from the constant the section „Wer Kibo macht“ shows
    expect(application).toMatchObject({
      author: {
        '@type': 'Person',
        name: author.name,
        url: author.url,
        sameAs: [author.github, author.mastodon],
      },
    })
    expect(video).toEqual(structuredData(page)[1])
    // Nothing the code doesn't know
    expect(said(application)).not.toMatch(/availability|seller|validFrom/)
  })

  // Then the price is the account's, and the offer says no more than that
  test('describes an offer that includes no Kita', () => {
    const facts = pricingFacts({ ...DEFAULTS, includedKitas: 0 })
    const [application] = structuredData({
      ...page,
      hosted: { facts, faq: [] },
    })
    expect(application).toMatchObject({
      offers: {
        description: 'Jahrespreis für ein Konto; jede Kita 10 € im Jahr',
      },
    })
  })

  test('makes the FAQPage from the entries the page shows', () => {
    const faq = faqEntries(FACTS, true)
    const data = structuredData({ ...page, hosted: { facts: FACTS, faq } })
    expect(data).toHaveLength(3)
    expect(data[2]).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'de',
      mainEntity: faq.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    })
  })
})

describe('films', () => {
  const absolute = (path: string) => new URL(path, 'https://kibo.example').href

  // The hosted film's structured data names its own files, the 30 seconds
  // and the day it was made
  test('describe the film the page shows', () => {
    const [, video] = structuredData({
      absolute,
      description: 'Das Brett',
      film: serviceFilm,
    })
    expect(video).toMatchObject({
      '@type': 'VideoObject',
      description: serviceFilm.description,
      thumbnailUrl: 'https://kibo.example/video/kibo-30s-poster.webp',
      contentUrl: 'https://kibo.example/video/kibo-30s-1080.mp4',
      uploadDate: '2026-10-11',
      duration: 'PT30S',
    })
  })

  // Its narration is an AI voice (AI Act Art. 50(4)); the film carries a
  // label, and the caption under the player says it too
  test('says under the hosted film that its voice is AI-generated', () => {
    expect(serviceFilm.caption).toStartWith(serviceFilm.description)
    expect(serviceFilm.caption).toContain('KI-generiert')
    expect(launchFilm.caption).toBe(launchFilm.description)
  })

  // Phones get the 720p files, everyone else the 1080p ones; AV1 first
  // where the browser plays it, H.264 for the rest
  test('offer each size as AV1 before H.264', () => {
    expect(
      serviceFilm.sources.map(({ src, media }) => [src, media ?? null]),
    ).toEqual([
      ['/video/kibo-30s-720.av1.mp4', '(max-width: 767px)'],
      ['/video/kibo-30s-720.mp4', '(max-width: 767px)'],
      ['/video/kibo-30s-1080.av1.mp4', null],
      ['/video/kibo-30s-1080.mp4', null],
    ])
  })

  test('name only files that are there', () => {
    for (const film of [launchFilm, serviceFilm]) {
      const paths = [
        film.poster,
        film.file,
        ...film.sources.map(({ src }) => src),
        ...(film.captions ? [film.captions] : []),
      ]
      for (const path of paths) expect(existsSync(`public${path}`)).toBe(true)
    }
  })
})

describe('jsonLd', () => {
  const BREAKOUT = '</script><script>alert(1)</script><!-- '

  test('is JSON that says what went in', () => {
    const data = structuredData({
      absolute: (path) => `https://kibo.example${path}`,
      description: 'Biete & Suche, "Pinnwand"',
      film: serviceFilm,
      hosted: hostedStartPage(DEFAULTS, true),
    })
    expect(JSON.parse(jsonLd(data))).toEqual(data)
  })

  // Nothing a value says can end the data block it is written into. The
  // price note is checked at start-up and is no part of the structured data.
  test('lets no configured value break out of the script element', () => {
    const facts = { ...FACTS, included: BREAKOUT, extra: BREAKOUT }
    const data = structuredData({
      absolute: (path) => `https://kibo.example${path}`,
      description: BREAKOUT,
      film: { ...serviceFilm, description: BREAKOUT },
      hosted: { facts, faq: [{ question: BREAKOUT, answer: BREAKOUT }] },
    })
    const html = jsonLd([data, facts])
    expect(html).not.toContain('<')
    expect(html.toLowerCase()).not.toContain('</script')
    expect(JSON.parse(html)).toEqual([data, facts])
  })
})
