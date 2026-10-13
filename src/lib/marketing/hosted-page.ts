import { NOTE_DURATIONS } from '@/lib/board/types'
import { dayCount, kitaCount } from '@/lib/hosted/billing'
import type { HostedPricing } from '@/lib/hosted/pricing'
import type { LegalPage } from '@/lib/legal'
import {
  HOSTED_DELETION_DAYS,
  HOSTED_DELETION_NOTICE_DAYS,
  HOSTED_GRACE_DAYS,
  HOSTED_ORGANIZATION_CAP,
  HOSTED_REMINDER_DAYS,
  MEMBERSHIP_LIMIT,
} from '@/lib/limits'

// What the start page of the hosted instance says about the service
// (src/pages/index.astro with src/components/marketing/): the price, the way
// in, what happens to the data, and the questions a Kita asks before it signs
// up. One source for the visible text and for the structured data search
// engines read, so the two can't drift apart. Every number comes from the
// configuration (hostedPricing) or from src/lib/limits.ts, and every sentence
// says something the code does — nothing about where the instance runs, who
// runs it or how well. Who wrote Kibo (`author`) is a fact of the software,
// not of the instance: whoever runs it is named in the footer.
//
// No server code and no environment in here, so the tests call it as it is.

// "inkl. 3 Kitas"; a price that includes none is the price of the account
function includedLabel(includedKitas: number) {
  return includedKitas ? `inkl. ${kitaCount(includedKitas)}` : 'für das Konto'
}

// What a Kita beyond the included ones adds. Without included ones that is
// every Kita.
function extraLabel({ includedKitas, extraKitaEur }: HostedPricing) {
  const further = includedKitas ? 'weitere ' : ''
  return extraKitaEur
    ? `jede ${further}Kita ${extraKitaEur} € im Jahr`
    : `${further}Kitas ohne Aufpreis`
}

// The numbers of the plan and how the page words them
export interface PricingFacts extends HostedPricing {
  included: string
  extra: string
  // „30 Tage kostenlos“
  trial: string
  // The price in one line, for the description and the questions below
  summary: string
}

// What else there is to know about paying: one sentence each, none of them
// with a number in it. Leaving early refunds nothing (AGB § 5 Abs. 6), said
// before anyone pays, not only in the terms.
export const pricingTerms = [
  'Ein Jahr im Voraus, auf Rechnung',
  'Keine automatische Verlängerung',
  'Hört ihr vor Ende des bezahlten Jahres auf, gibt es kein Geld anteilig zurück',
  'Für die Testphase braucht ihr keine Zahlungsdaten',
  'Das Angebot richtet sich an Kitas und Träger',
] as const

// The one plan there is, in the words of the page
export function pricingFacts(pricing: HostedPricing): PricingFacts {
  const included = includedLabel(pricing.includedKitas)
  const extra = extraLabel(pricing)
  return {
    ...pricing,
    included,
    extra,
    trial: `${dayCount(pricing.trialDays)} kostenlos`,
    summary: `${pricing.priceEur} € im Jahr ${included}, ${extra}`,
  }
}

// What the main button says, and the page's title after the product's name:
// „30 Tage kostenlos testen“
function trialCta({ trial }: PricingFacts) {
  return `${trial} testen`
}

// What the page's description says on the hosted instance, after the
// sentence about the product: „30 Tage kostenlos testen, danach 49 € im Jahr
// für bis zu 3 Kitas.“ Short, so that a search engine shows all of it, and
// without the trial where the sign-up is closed.
export function serviceSummary(facts: PricingFacts, signupOpen: boolean) {
  const price = facts.includedKitas
    ? `${facts.priceEur} € im Jahr für bis zu ${kitaCount(facts.includedKitas)}`
    : facts.summary
  return signupOpen ? `${trialCta(facts)}, danach ${price}.` : `${price}.`
}

export interface Step {
  title: string
  body: string
}

// From nothing to a paid year. Where the sign-up is closed the first step is
// not the visitor's to take.
export function howItWorks(
  pricing: HostedPricing,
  signupOpen: boolean,
): Step[] {
  const first = signupOpen
    ? {
        title: 'Registrieren',
        body: 'Mit Name, E-Mail-Adresse und Passwort. Die Adresse bestätigt ihr über den Link aus der Mail.',
      }
    : {
        title: 'Konto bekommen',
        body: 'Die Registrierung ist hier geschlossen: Konten legt der Betrieb an, oder eine Kita lädt euch ein.',
      }
  return [
    first,
    {
      title: 'Kita anlegen',
      body: 'Ein Name genügt. Dabei stimmt ihr den AGB und dem AV-Vertrag zu, und die Testphase beginnt.',
    },
    {
      title: 'Bretter teilen',
      body: 'Ihr legt Bretter an und gebt den Link weiter oder hängt den QR-Code in den Flur.',
    },
    {
      title: `${dayCount(pricing.trialDays)} testen`,
      body: 'Alles funktioniert ohne Einschränkung, für eine Kita. Die Testphase endet von selbst.',
    },
    {
      title: 'Rechnung anfordern',
      body: 'Im Admin-Bereich unter „Abo“. Nach Zahlungseingang ist das Abo für ein Jahr freigeschaltet.',
    },
  ]
}

interface TrustPoint {
  title: string
  body: string
  // The legal page the point leads to, and what the link says
  link?: { page: LegalPage; label: string }
}

// "7, 14 oder 30": how long a note can hang, for every sentence that says so
export const noteDurations = `${NOTE_DURATIONS.slice(0, -1).join(', ')} oder ${NOTE_DURATIONS.at(-1)}`

// The point „Kein Tracking“, which trustPointsFor swaps while the start page
// counts its page views
const NO_TRACKING: TrustPoint = {
  title: 'Kein Tracking',
  body: 'Die Seiten laden nichts von fremden Servern nach: keine Analyse-Skripte, keine fremden Schriften.',
}

// Only what the code sees to: the CSP lets a page load nothing from anywhere
// else, a board takes notes without an account, the hourly run removes what
// has expired, and the first Kita comes with the data processing agreement
export const trustPoints: readonly TrustPoint[] = [
  {
    title: 'Keine Werbung',
    body: 'Kibo zeigt keine Werbung, weder auf den Brettern noch im Admin-Bereich.',
  },
  NO_TRACKING,
  {
    title: 'Keine Konten für Eltern',
    body: 'Eltern öffnen den Link und pinnen ihren Zettel an, ohne Registrierung und ohne App.',
  },
  {
    title: 'Zettel laufen von selbst ab',
    body: `Jeder Zettel hängt ${noteDurations} Tage und wird danach gelöscht. Die Kita kann jeden Zettel vorher abnehmen.`,
  },
  {
    title: 'AV-Vertrag',
    body: 'Mit eurer ersten Kita schließt ihr den Vertrag zur Auftragsverarbeitung ab. Lesen könnt ihr ihn vorher.',
    link: { page: 'avv', label: 'AV-Vertrag lesen' },
  },
  {
    title: 'Datenschutzerklärung',
    body: 'Welche Daten Kibo speichert und wie lange, steht in der Datenschutzerklärung.',
    link: { page: 'datenschutz', label: 'Datenschutzerklärung lesen' },
  },
]

// What takes the place of „Kein Tracking“ while the start page counts its
// page views (PLAUSIBLE_DOMAIN, src/lib/analytics/pageview.ts): still no
// analytics script and nothing from another server, but the server reports
// the views of this one page. Only what the code sees to — no cookie, nothing
// counted with Do Not Track or Global Privacy Control, and no other page
// reports anything.
const COUNTED_VISITS: TrustPoint = {
  title: 'Kein Tracking auf den Brettern',
  body: 'Die Seiten laden nichts von fremden Servern nach: keine Analyse-Skripte, keine fremden Schriften. Nur die Aufrufe dieser Startseite meldet Kibos Server an Plausible, ohne Cookies und nicht bei „Do Not Track“ oder Global Privacy Control; Bretter und Admin-Bereich zählen nichts.',
}

// The trust points as the start page shows them: as above, unless it counts
export function trustPointsFor(counting: boolean): readonly TrustPoint[] {
  if (!counting) return trustPoints
  return trustPoints.map((point) =>
    point === NO_TRACKING ? COUNTED_VISITS : point,
  )
}

export interface FaqEntry {
  question: string
  answer: string
}

// What happens once a trial or a paid year is over, for the two questions
// that ask about it, in the order it happens: the grace period, in which the
// boards work and no new Kita is created, the pause, which stores everything
// but keeps no note past its date (the hourly run removes expired notes
// whatever the subscription says), and the deletion, up to which paying
// brings the boards back
const DELETION =
  `Frühestens ${HOSTED_DELETION_DAYS} Tage nach dem Ablauf werden die Kitas des Kontos gelöscht; ` +
  `das kündigt Kibo ${HOSTED_DELETION_NOTICE_DAYS} Tage vorher per E-Mail an.`
const AFTER_THE_END =
  `Danach funktionieren eure Bretter noch ${HOSTED_GRACE_DAYS} Tage weiter, neue Kitas lassen sich nicht mehr anlegen. ` +
  'Ohne bezahltes Abo werden die Bretter dann pausiert: Eltern können sie nicht mehr öffnen. ' +
  'Bretter und Zettel bleiben gespeichert, Zettel laufen aber wie gewohnt ab. ' +
  `${DELETION} Bis dahin geht es unter denselben Links weiter, sobald das Abo bezahlt ist.`

// The questions and their answers, as plain text: the page shows them, and
// the FAQPage in the structured data is made from the same entries. How to
// start is only asked where a visitor can.
export function faqEntries(
  facts: PricingFacts,
  signupOpen: boolean,
): FaqEntry[] {
  const start = signupOpen
    ? [
        {
          question: 'Wie fangen wir an?',
          answer: `Ihr registriert euch mit Name, E-Mail-Adresse und Passwort, bestätigt die Adresse und legt eure Kita an. Damit beginnt die Testphase: ${facts.trial}, ohne Zahlungsdaten.`,
        },
      ]
    : []
  return [
    {
      question: 'Brauchen Eltern ein Konto?',
      answer:
        'Nein. Eltern öffnen den Link oder scannen den QR-Code eines Bretts und pinnen ihren Zettel an, ohne Registrierung und ohne App. Ein Konto braucht nur, wer die Kita verwaltet.',
    },
    ...start,
    {
      question: 'Was passiert nach der Testphase?',
      answer: `Die Testphase endet von selbst und geht nicht in ein bezahltes Abo über. Tut ihr nichts, entstehen keine Kosten. ${AFTER_THE_END}`,
    },
    {
      question: 'Wie bezahlen wir?',
      answer:
        'Auf Rechnung, ein Jahr im Voraus. Im Admin-Bereich unter „Abo“ fordert ihr die Rechnung an, sie kommt per E-Mail. Nach Zahlungseingang ist das Abo für ein Jahr freigeschaltet. Zahlungsdaten hinterlegt ihr bei Kibo nicht.',
    },
    {
      question: 'Müssen wir kündigen? Was passiert, wenn wir nicht verlängern?',
      answer: `Zu kündigen gibt es nichts: Das Abo verlängert sich nicht automatisch. Für jedes weitere Jahr fordert ihr eine neue Rechnung an; ${HOSTED_REMINDER_DAYS} Tage vor dem Ende erinnert Kibo per E-Mail. Ohne Verlängerung läuft das Abo aus. Hört ihr vor Ende eines bezahlten Jahres auf, etwa indem ihr euer Konto löscht oder zu einem anderen Anbieter wechselt, bekommt ihr den bezahlten Betrag nicht anteilig zurück. ${AFTER_THE_END}`,
    },
    {
      question: 'Wir sind ein Träger mit mehreren Kitas. Geht das?',
      answer: `Ja. Abgerechnet wird das Konto, nicht die einzelne Kita: ${facts.summary}. In der Testphase legt ihr eine Kita an, mit bezahltem Abo bis zu ${HOSTED_ORGANIZATION_CAP} pro Konto.`,
    },
    {
      question: 'Können mehrere Personen eine Kita verwalten?',
      answer: `Ja. Wer die Kita angelegt hat, lädt weitere Admins per E-Mail ein; bis zu ${MEMBERSHIP_LIMIT} Personen verwalten eine Kita gemeinsam. Eingeladene Admins zahlen nichts und brauchen kein eigenes Abo.`,
    },
    {
      question: 'Was passiert mit unseren Daten?',
      answer: `Zettel verschwinden nach ${noteDurations} Tagen von selbst, und die Kita kann jeden Zettel vorher abnehmen. Löscht ihr euer Konto, werden eure Kitas mit allen Brettern und Zetteln mitgelöscht. Läuft das Abo aus, bleiben Kitas und Bretter zunächst gespeichert, Zettel laufen weiter wie gewohnt ab. ${DELETION}`,
    },
    {
      question: 'Können wir Kibo auch selbst betreiben?',
      answer:
        'Ja. Kibo ist freie Software unter der AGPL-3.0, der Quelltext ist öffentlich. Wie ihr eine eigene Instanz betreibt, steht in der Dokumentation unter „Selbst hosten“. Auf einer eigenen Instanz gibt es kein Abo und keine Fristen.',
    },
  ]
}

// Everything about the service the start page says with the instance's
// numbers, built once per request. The trial is only advertised — on the
// main button, in the title, in the description — where a visitor can sign
// up and start one: `cta` is missing where the sign-up is closed.
export function hostedStartPage(pricing: HostedPricing, signupOpen: boolean) {
  const facts = pricingFacts(pricing)
  return {
    facts,
    cta: signupOpen ? trialCta(facts) : undefined,
    summary: serviceSummary(facts, signupOpen),
    steps: howItWorks(pricing, signupOpen),
    faq: faqEntries(facts, signupOpen),
  }
}

// Who develops Kibo — not necessarily who runs this instance. The section
// „Wer Kibo macht“ (src/components/marketing/Author.astro) and the
// structured data name him from here.
export const author = {
  name: 'Florian van der Galiën',
  url: 'https://flori.dev',
  github: 'https://github.com/florivdg',
  mastodon: 'https://sueden.social/@florivdg',
} as const

const authorPerson = {
  '@type': 'Person',
  name: author.name,
  url: author.url,
  sameAs: [author.github, author.mastodon],
}

export interface FilmSource {
  src: string
  type: string
  // Which screens the file is for; without it, any
  media?: string
}

// A film on the start page: the player's files and what the page and the
// structured data say about it
export interface Film {
  description: string
  // What the caption under the player says
  caption: string
  poster: string
  // In the order the browser tries them
  sources: readonly FilmSource[]
  // The file the download link and search engines get
  file: string
  fileLabel: string
  captions?: string
  uploadDate: string
  // ISO 8601, as schema.org wants it
  duration: string
}

const launchDescription =
  'Kibo in 20 Sekunden: Fundkiste, Biete & Suche und Pinnwand einer Kita. Zettel werden angepinnt, Eltern bekommen auf Wunsch eine Benachrichtigung aufs Handy, und nach ein paar Tagen verschwinden die Zettel von selbst.'

// The film every instance shows. It says nothing about where the instance
// runs, so it holds wherever Kibo is hosted.
export const launchFilm: Film = {
  description: launchDescription,
  caption: launchDescription,
  poster: '/video/kibo-launch-poster.webp',
  sources: [{ src: '/video/kibo-launch.mp4', type: 'video/mp4' }],
  file: '/video/kibo-launch.mp4',
  fileLabel: 'MP4, 20 Sekunden',
  uploadDate: '2026-09-29',
  duration: 'PT20S',
}

const serviceDescription =
  'Kibo in 30 Sekunden: Fundkiste, Biete & Suche und Pinnwand einer Kita, neue Zettel als Benachrichtigung aufs Handy und der Datenschutz: gehostet in Deutschland, keine Konten für Eltern, kein Tracking auf den Brettern, und jeder Zettel löscht sich von selbst.'

// The hosted instance's film, narrated, with the service's hosting in it —
// true only there (legal/datenschutz.md), so no other instance shows it. Made
// in videos/kibo-launch; AV1 where the browser plays it, H.264 otherwise, 720p
// for phones. The narration is an AI voice, which AI Act Art. 50(4) wants
// said: the film carries a label throughout, the caption says it as well.
export const serviceFilm: Film = {
  description: serviceDescription,
  caption: `${serviceDescription} Stimme und Musik sind KI-generiert.`,
  poster: '/video/kibo-30s-poster.webp',
  sources: [
    {
      src: '/video/kibo-30s-720.av1.mp4',
      type: 'video/mp4; codecs="av01.0.05M.08, mp4a.40.2"',
      media: '(max-width: 767px)',
    },
    {
      src: '/video/kibo-30s-720.mp4',
      type: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
      media: '(max-width: 767px)',
    },
    {
      src: '/video/kibo-30s-1080.av1.mp4',
      type: 'video/mp4; codecs="av01.0.08M.08, mp4a.40.2"',
    },
    {
      src: '/video/kibo-30s-1080.mp4',
      type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    },
  ],
  file: '/video/kibo-30s-1080.mp4',
  fileLabel: 'MP4, 30 Sekunden',
  captions: '/video/kibo-30s.de.vtt',
  uploadDate: '2026-10-11',
  duration: 'PT30S',
}

interface StructuredDataInput {
  // Turns a path into the address under the instance's public origin
  absolute: (path: string) => string
  description: string
  film: Film
  // Only the hosted instance has a price and questions about it
  hosted?: { facts: PricingFacts; faq: readonly FaqEntry[] }
}

// The one price there is. Nothing about availability or a seller: the code
// knows neither.
function offer({ priceEur, includedKitas, included, extra }: PricingFacts) {
  const account = includedKitas ? `ein Konto, ${included}` : 'ein Konto'
  return {
    '@type': 'Offer',
    price: String(priceEur),
    priceCurrency: 'EUR',
    description: `Jahrespreis für ${account}; ${extra}`,
  }
}

function faqPage(faq: readonly FaqEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'de',
    mainEntity: faq.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }
}

// Structured data for search engines: the product and the launch video, on
// the hosted instance its author, the price as an Offer and the questions as
// a FAQPage.
// Without `hosted` it is what the start page has always said, key for key.
export function structuredData({
  absolute,
  description,
  film,
  hosted,
}: StructuredDataInput): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Kibo',
      url: absolute('/'),
      description,
      image: absolute('/og-image.jpg'),
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Web',
      inLanguage: 'de',
      ...(hosted && {
        author: authorPerson,
        offers: offer(hosted.facts),
      }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: 'Kibo – das digitale Brett für eure Kita',
      description: film.description,
      thumbnailUrl: absolute(film.poster),
      contentUrl: absolute(film.file),
      uploadDate: film.uploadDate,
      duration: film.duration,
      inLanguage: 'de',
    },
    ...(hosted ? [faqPage(hosted.faq)] : []),
  ]
}

// What goes between the tags of a <script type="application/ld+json">. JSON
// itself doesn't mind a "</script>" in a string, the HTML parser around it
// does: every "<" is written as its escape, which also covers "<!--". A data
// block is not executed, so the CSP has nothing to say about it either way.
export function jsonLd(data: unknown) {
  return JSON.stringify(data).replaceAll('<', String.raw`\u003c`)
}
