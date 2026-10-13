import {
  DATENSCHUTZ_URL,
  DOCS_URL,
  HOSTED,
  HOSTED_EXTRA_KITA_EUR,
  HOSTED_INCLUDED_KITAS,
  HOSTED_OPERATOR_EMAIL,
  HOSTED_PRICE_EUR,
  HOSTED_PRICE_NOTE,
  HOSTED_TERMS_VERSION,
  HOSTED_TRIAL_DAYS,
  IMPRESSUM_URL,
  OPERATOR_ADDRESS,
  OPERATOR_EMAIL,
  OPERATOR_LEGAL_INFO,
  OPERATOR_NAME,
  PLAUSIBLE_DOMAIN,
  PLAUSIBLE_URL,
  SIGNUP_EMAIL_DOMAINS,
  SIGNUP_MODE,
  SOURCE_URL,
} from 'astro:env/server'

import type { HostedPricing } from '@/lib/hosted/pricing'
import type { SignupPolicy } from '@/lib/signup-rules'

import { version } from '../../package.json'
import {
  DEFAULT_DOCS_URL,
  DEFAULT_PLAUSIBLE_URL,
  HOSTED_PRICING_DEFAULTS,
  type OperatorDetails,
  instanceConfigProblems,
  parseDocsUrl,
  parseEmailDomains,
  parseHosted,
  parseHostedPricing,
  parseOperatorDetails,
  parseOperatorEmail,
  parsePlausibleDomain,
  parsePlausibleUrl,
  parsePriceNote,
  parseSignupMode,
  parseSourceUrl,
  parseTermsVersion,
  REPOSITORY_URL,
} from '../../scripts/instance-config.mjs'

// What this instance is set up to be, read once from the environment: who may
// sign up, and whether it is the hosted instance. The rules themselves live in
// scripts/instance-config.mjs, which the start-up check and scripts/admin.ts
// share.
//
// scripts/server.mjs refuses to start with a value nobody can parse. `astro
// dev` doesn't go through it, so the same problems stop the dev server here.
const env = {
  SIGNUP_MODE,
  SIGNUP_EMAIL_DOMAINS,
  HOSTED,
  DOCS_URL,
  HOSTED_PRICE_EUR,
  HOSTED_INCLUDED_KITAS,
  HOSTED_EXTRA_KITA_EUR,
  HOSTED_TRIAL_DAYS,
  HOSTED_TERMS_VERSION,
  HOSTED_OPERATOR_EMAIL,
  HOSTED_PRICE_NOTE,
  SOURCE_URL,
  PLAUSIBLE_DOMAIN,
  PLAUSIBLE_URL,
  OPERATOR_NAME,
  OPERATOR_ADDRESS,
  OPERATOR_EMAIL,
  OPERATOR_LEGAL_INFO,
  IMPRESSUM_URL,
  DATENSCHUTZ_URL,
}
const problems = instanceConfigProblems(env)
if (problems.length) throw new Error(`[server] ${problems.join('; ')}`)

// `open`: whether anyone may create an account. Closed, accounts come from
// the operator (scripts/admin.ts) or from an invitation to a Kita.
// `domains`: the mail domains an account may have, for a new account, a
// changed address and an invited one alike. Empty: any.
//
// One object rather than two constants, so the tests can set up an instance
// of another kind in place (the test environment is open and has no list).
export const signupPolicy: SignupPolicy = {
  open: parseSignupMode(SIGNUP_MODE) === 'open',
  domains: parseEmailDomains(SIGNUP_EMAIL_DOMAINS).domains,
}

// `hosted`: the one instance Kibo's maintainer runs for everyone, as opposed
// to an instance somebody hosts for their own Kitas. It serves the
// documentation under /docs, and the accounts that own Kitas on it have a
// subscription (src/lib/hosted/). An object for the same reason as above.
export const instanceMode = {
  hosted: parseHosted(HOSTED) === true,
}

// What a subscription costs and how long its trial runs (HOSTED_*), only
// looked at when the instance is hosted. An invalid value has stopped the
// server above; the fallback is what tells the type so. An object the tests
// change in place, like the two above.
export const hostedPricing: HostedPricing = parseHostedPricing(env) ?? {
  ...HOSTED_PRICING_DEFAULTS,
}

// What the hosted instance needs besides: the name of the terms an account
// agrees to with its first Kita (HOSTED_TERMS_VERSION, stored with the
// agreement) and the address invoice requests go to (HOSTED_OPERATOR_EMAIL).
// With HOSTED=true a missing one has stopped the server above; without, both
// may be empty and nothing reads them. Changed in place by the tests as well.
export const hostedContact = {
  termsVersion: parseTermsVersion(HOSTED_TERMS_VERSION) ?? '',
  operatorEmail: parseOperatorEmail(HOSTED_OPERATOR_EMAIL) ?? '',
}

// HOSTED_PRICE_NOTE: one line the operator puts below the price, on the start
// page and on the subscription page — what it says about VAT, for one. Empty
// when there is none, and then nothing is said about it. An object of its
// own rather than a part of the pricing, which invoices are calculated from.
export const hostedPriceNote = {
  text: parsePriceNote(HOSTED_PRICE_NOTE) ?? '',
}

// Who runs this instance, as the footer of every mail names them
// (src/lib/mail/footer.ts): OPERATOR_NAME, the lines of OPERATOR_ADDRESS,
// OPERATOR_EMAIL and the lines of OPERATOR_LEGAL_INFO. Not to be confused
// with HOSTED_OPERATOR_EMAIL above, the mailbox invoice requests go to. With
// HOSTED=true the first three have stopped the server above when missing;
// elsewhere each may be empty, which the start-up log points out
// (logOperatorConfiguration in src/lib/mail/footer.ts). An invalid value has
// stopped the server either way. Changed in place by the tests.
export const operatorDetails: OperatorDetails = parseOperatorDetails(env) ?? {
  name: '',
  address: [],
  email: '',
  legalInfo: [],
}

// Where the footer of every page says the source of this instance is, and
// the version it runs. Kibo is AGPL: whoever runs a changed version points
// SOURCE_URL at that version's source (§ 13), everyone else at the
// repository. The version is the one the image was built from — package.json
// is compiled in, nothing about it comes from the environment.
export const sourceLink = {
  href: parseSourceUrl(SOURCE_URL) ?? REPOSITORY_URL,
  version,
}

// Page views of the hosted start page, counted by Plausible: `domain` is the
// site as Plausible knows it (PLAUSIBLE_DOMAIN, empty: nothing is counted),
// `url` the instance the counts go to (PLAUSIBLE_URL, with a trailing slash).
// Only the hosted instance counts, and only on / (src/lib/analytics/). An
// object the tests change in place, like the ones above.
export const analytics = {
  domain: parsePlausibleDomain(PLAUSIBLE_DOMAIN) ?? '',
  url: parsePlausibleUrl(PLAUSIBLE_URL) ?? DEFAULT_PLAUSIBLE_URL,
}

// Whether the start page counts its page views: hosted, and a domain set
export function analyticsEnabled() {
  return instanceMode.hosted && analytics.domain !== ''
}

// The project's own repository, whatever SOURCE_URL says: where the hosted
// start page sends whoever would rather run Kibo themselves
export { REPOSITORY_URL }

// DOCS_URL, read once like the rest. An invalid value has stopped the server
// above; the fallback is what tells the type so.
const docsUrl = parseDocsUrl(DOCS_URL) ?? DEFAULT_DOCS_URL

// Where the admin area's help link leads: the instance's own /docs when it
// serves them, otherwise DOCS_URL (the documentation on GitHub unless the
// operator points somewhere else). Hosted, DOCS_URL is ignored.
export function docsHref() {
  return instanceMode.hosted ? '/docs' : docsUrl
}

// Once at start-up, next to the SMTP line: who can get an account here, and
// what kind of instance this is
export function logInstanceConfiguration() {
  const state = signupPolicy.open ? 'offen' : 'geschlossen'
  const restricted = signupPolicy.domains.length
    ? `, E-Mail-Domains: ${signupPolicy.domains.join(', ')}`
    : ''
  console.info(`[auth] Registrierung ${state}${restricted}`)
  console.info(
    instanceMode.hosted
      ? `[server] Modus: gehostet – Dokumentation unter /docs, ${pricingSummary()}`
      : `[server] Modus: selbst gehostet – Dokumentation: ${docsHref()}`,
  )
  logAnalytics()
}

// Whether the start page counts, and where to — or why it doesn't, when the
// domain is set on an instance that isn't hosted
function logAnalytics() {
  if (analyticsEnabled()) {
    console.info(
      `[server] Besucherzählung der Startseite: Plausible (${analytics.domain}) über ${analytics.url}`,
    )
  } else if (analytics.domain) {
    console.info(
      '[server] PLAUSIBLE_DOMAIN ist gesetzt, gezählt wird aber nur mit HOSTED=true',
    )
  }
}

// "49 €/Jahr inkl. 3 Kitas, +10 €/Kita, 30 Tage Test"
function pricingSummary() {
  const { priceEur, includedKitas, extraKitaEur, trialDays } = hostedPricing
  return (
    `${priceEur} €/Jahr inkl. ${includedKitas} Kitas, ` +
    `+${extraKitaEur} €/Kita, ${trialDays} Tage Test`
  )
}
