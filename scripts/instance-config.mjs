// @ts-check
// The rules behind SIGNUP_MODE, SIGNUP_EMAIL_DOMAINS, HOSTED, DOCS_URL,
// SOURCE_URL, the HOSTED_* settings (HOSTED_PRICE_NOTE among them), the
// page-view counting of the hosted start page (PLAUSIBLE_*), the OPERATOR_*
// details and the addresses of the legal pages mails link (IMPRESSUM_URL,
// DATENSCHUTZ_URL, AGB_URL, AVV_URL), once for everyone who needs them:
// scripts/server.mjs refuses to start on a value nobody can parse,
// src/lib/instance.ts applies them in the app, and scripts/admin.ts when an
// operator creates an account or looks at the subscriptions.
//
// Plain JavaScript without a dependency: the image copies this file next to
// server.mjs, where there is no src/ and nothing gets built. It reads no
// environment and logs nothing — it parses, normalises and matches. That is
// also why the patterns of plain text are defined here: the price note and
// the operator details are held to them, and src/lib/plain-text.ts takes them
// from this file.

const SIGNUP_MODES = /** @type {const} */ (['open', 'closed'])

/** @typedef {(typeof SIGNUP_MODES)[number]} SignupMode */

/**
 * Unset or empty is `open`, which is how Kibo behaved before the variable
 * existed. Anything else has to be one of the modes, spelled exactly.
 *
 * @param {string | undefined} raw
 * @returns {SignupMode | undefined} undefined for a value that is neither
 */
export function parseSignupMode(raw) {
  const value = (raw ?? '').trim()
  if (value === '') return 'open'
  return SIGNUP_MODES.find((mode) => mode === value)
}

// Longest name DNS allows, and what one label of it may look like
const HOSTNAME_MAX = 253
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
// Everything that means something in a URL. The parser below would read a
// port, a path or a user name out of these and hand back a clean host name.
const NOT_A_HOSTNAME = /[\s/\\:@?#%[\]]/

/**
 * A host name the way DNS compares it: lower case, IDN as punycode, without
 * the trailing dot.
 *
 * @param {string} value
 * @returns {string | undefined} undefined for anything that is no domain
 */
function normalizeHostname(value) {
  const name = value.trim().replace(/\.$/, '')
  if (NOT_A_HOSTNAME.test(name)) return undefined
  let url
  try {
    url = new URL(`http://${name}`)
  } catch {
    return undefined
  }
  const { hostname } = url
  if (url.href !== `http://${hostname}/`) return undefined
  if (hostname.length > HOSTNAME_MAX) return undefined
  const labels = hostname.split('.')
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) {
    return undefined
  }
  // A numeric last label is an IP address, which the parser also accepts
  return /^\d+$/.test(labels.at(-1) ?? '') ? undefined : hostname
}

/**
 * One entry of SIGNUP_EMAIL_DOMAINS: a domain, or `*.` in front of one for
 * its subdomains.
 *
 * @param {string} value
 * @returns {string | undefined} the entry as it is compared, or undefined
 */
export function normalizeEmailDomain(value) {
  const entry = value.trim()
  if (!entry.startsWith('*.')) return normalizeHostname(entry)
  const domain = normalizeHostname(entry.slice(2))
  return domain && `*.${domain}`
}

/**
 * The comma-separated list. Entries nobody can parse come back as typed, so
 * the caller can name them.
 *
 * @param {string | undefined} raw
 * @returns {{ domains: string[], invalid: string[] }}
 */
export function parseEmailDomains(raw) {
  /** @type {string[]} */
  const domains = []
  /** @type {string[]} */
  const invalid = []
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const domain = normalizeEmailDomain(entry)
    if (!domain) invalid.push(entry)
    else if (!domains.includes(domain)) domains.push(domain)
  }
  return { domains, invalid }
}

/**
 * The domain of an address, normalised like the entries of the list.
 *
 * @param {string} email
 * @returns {string | undefined} undefined when there is no domain to compare
 */
export function emailDomainOf(email) {
  const at = email.lastIndexOf('@')
  return at > 0 ? normalizeHostname(email.slice(at + 1)) : undefined
}

/**
 * Whether the list lets this address in. An empty list restricts nothing.
 * `*.example.org` covers the subdomains at any depth but not example.org
 * itself, like a wildcard in DNS or a certificate; who wants both lists both.
 *
 * @param {string} email
 * @param {readonly string[]} domains entries as parseEmailDomains returns them
 */
export function isEmailDomainAllowed(email, domains) {
  if (domains.length === 0) return true
  const domain = emailDomainOf(email)
  if (!domain) return false
  return domains.some((entry) =>
    // Keeps the dot: "x.example.org" ends with ".example.org", the bare
    // domain and "notexample.org" don't
    entry.startsWith('*.') ? domain.endsWith(entry.slice(1)) : domain === entry,
  )
}

/**
 * @param {string[]} invalid
 * @returns {string}
 */
export function invalidEmailDomainsProblem(invalid) {
  return `SIGNUP_EMAIL_DOMAINS enthält ungültige Einträge: ${invalid.join(', ')}`
}

/**
 * Whether this is the hosted instance. Unset or empty is `false`: an instance
 * somebody runs for their own Kitas. Spelled exactly, like SIGNUP_MODE — what
 * hangs on it is not for a typo to decide.
 *
 * @param {string | undefined} raw
 * @returns {boolean | undefined} undefined for a value that is neither
 */
export function parseHosted(raw) {
  const value = (raw ?? '').trim()
  if (value === '' || value === 'false') return false
  return value === 'true' ? true : undefined
}

// Where the source lives. The documentation links here for everything that
// is no page of its own (src/lib/docs/doc-links.ts).
export const REPOSITORY_URL = 'https://github.com/florivdg/kibo'

// Where the documentation is read when the instance doesn't serve it itself:
// the folder the pages under /docs are rendered from
export const DEFAULT_DOCS_URL = `${REPOSITORY_URL}/tree/main/docs`

/**
 * A web address from the environment: `fallback` when unset or empty,
 * otherwise an address with http:// or https:// the way the parser writes it.
 *
 * @param {string | undefined} raw
 * @param {string} fallback
 * @returns {string | undefined} undefined for anything that is no web address
 */
function parseWebUrl(raw, fallback) {
  const value = (raw ?? '').trim()
  if (value === '') return fallback
  let url
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.href
    : undefined
}

/**
 * The address the admin area's help link opens on a self-hosted instance.
 * Unset or empty is the documentation on GitHub.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} undefined for anything that is no web address
 */
export function parseDocsUrl(raw) {
  return parseWebUrl(raw, DEFAULT_DOCS_URL)
}

/**
 * SOURCE_URL: where the footer of every page says the source of this instance
 * is. Unset or empty is the repository. Kibo is AGPL, so whoever runs a
 * changed version for others has to offer them its source (§ 13) and points
 * the link there.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} undefined for anything that is no web address
 */
export function parseSourceUrl(raw) {
  return parseWebUrl(raw, REPOSITORY_URL)
}

// Where page views are counted when PLAUSIBLE_URL is unset or empty
export const DEFAULT_PLAUSIBLE_URL = 'https://plausible.io/'

/**
 * PLAUSIBLE_DOMAIN: the site as Plausible knows it, a bare domain like
 * `kibo.example`. Unset or empty is no counting at all. The start page only
 * counts with HOSTED=true (src/lib/instance.ts); a typo is refused either way.
 * Plausible matches the events by the name exactly as it was entered there,
 * so an IDN stays as it is typed — only in lower case, without the dot DNS
 * allows at the end.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} '' when unset; undefined for anything that is
 *   no domain (a scheme, a path, a port, an IP address)
 */
export function parsePlausibleDomain(raw) {
  const value = (raw ?? '').trim().replace(/\.$/, '').toLowerCase()
  if (value === '') return ''
  return normalizeHostname(value) ? value : undefined
}

/**
 * PLAUSIBLE_URL: the Plausible instance the counts go to, plausible.io or a
 * self-hosted one, possibly under a path. Comes back with a trailing slash,
 * so `api/event` can be resolved against it.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} undefined for anything that is no http(s)
 *   address, or one with a user name, a query or a fragment
 */
export function parsePlausibleUrl(raw) {
  const href = parseWebUrl(raw, DEFAULT_PLAUSIBLE_URL)
  if (!href) return undefined
  const url = new URL(href)
  if (url.username || url.password || url.search || url.hash) return undefined
  return `${url.origin}${url.pathname.replace(/\/*$/, '/')}`
}

// What a line of text a person typed looks like: the patterns behind every
// name, title and note in Kibo (src/lib/plain-text.ts) and behind the price
// note below.
//
// Control characters (NUL included), lone surrogates, the bidi overrides and
// isolates that make text read differently from how it is stored, and the
// Unicode line and paragraph separators. None of these is typed by a person.
export const FORBIDDEN_SINGLE_LINE =
  /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069\u2028\u2029]/u
// Anything a reader can actually see: not whitespace, not a format or control
// character, not a lone combining mark, and none of the blank letters
// (Hangul fillers, the empty braille pattern) that render as nothing
export const VISIBLE =
  /[^\s\p{Cc}\p{Cf}\p{Cs}\p{M}\p{Z}\u115F\u1160\u3164\uFFA0\u2800]/u
// An address has no business in a name that ends up in a mail to someone
// else (a person's name, or the Kita an invitation names), nor in a line the
// operator puts on a public page
export const LOOKS_LIKE_LINK = /:\/\/|\bwww\.|\bhttps?:/i

const PRICE_NOTE_MAX = 200

/**
 * HOSTED_PRICE_NOTE: one line the operator puts below the price, e.g. what
 * it says about VAT. Unset or empty is no note at all.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} '' when unset; undefined for more than a
 *   line, more than 200 characters, nothing visible, or a link
 */
export function parsePriceNote(raw) {
  const value = (raw ?? '').trim()
  if (value === '') return ''
  const plain =
    value.length <= PRICE_NOTE_MAX &&
    !FORBIDDEN_SINGLE_LINE.test(value) &&
    VISIBLE.test(value)
  return plain && !LOOKS_LIKE_LINK.test(value) ? value : undefined
}

/**
 * What the hosted instance charges and how long it lets an account try it:
 * whole euros a year, the Kitas that price includes, whole euros a year for
 * every Kita beyond them, and the days of the trial.
 *
 * @typedef {{ priceEur: number, includedKitas: number, extraKitaEur: number, trialDays: number }} HostedPricing
 */

// Marked as free of side effects, as everything at the top of this file has
// to be: the forms in the browser take the patterns above from it, and their
// bundle is to carry nothing else.
/** @type {Readonly<HostedPricing>} */
export const HOSTED_PRICING_DEFAULTS = /* @__PURE__ */ Object.freeze({
  priceEur: 49,
  includedKitas: 3,
  extraKitaEur: 10,
  trialDays: 30,
})

// Each number with the smallest value that makes sense: a price of 0 is a
// free instance, a trial of 0 days is none at all
const HOSTED_NUMBERS = /** @type {const} */ ([
  { name: 'HOSTED_PRICE_EUR', key: 'priceEur', min: 0 },
  { name: 'HOSTED_INCLUDED_KITAS', key: 'includedKitas', min: 0 },
  { name: 'HOSTED_EXTRA_KITA_EUR', key: 'extraKitaEur', min: 0 },
  { name: 'HOSTED_TRIAL_DAYS', key: 'trialDays', min: 1 },
])

// Digits only: "1e3", "1.5" and "-1" are all numbers to Number(), and none of
// them is what an invoice should be written from
const WHOLE_NUMBER = /^\d{1,6}$/

/**
 * One of the HOSTED_* numbers. Unset or empty is the default.
 *
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {number} min
 * @returns {number | undefined} undefined for anything that is no such number
 */
function parseWholeNumber(raw, fallback, min) {
  const value = (raw ?? '').trim()
  if (value === '') return fallback
  if (!WHOLE_NUMBER.test(value)) return undefined
  const number = Number(value)
  return number >= min ? number : undefined
}

/**
 * HOSTED_PRICE_EUR, HOSTED_INCLUDED_KITAS, HOSTED_EXTRA_KITA_EUR and
 * HOSTED_TRIAL_DAYS. Read whether or not the instance is hosted, like
 * DOCS_URL: a typo is a typo either way.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {HostedPricing | undefined} undefined when one of them is invalid
 */
export function parseHostedPricing(env) {
  /** @type {HostedPricing} */
  const pricing = { ...HOSTED_PRICING_DEFAULTS }
  for (const { name, key, min } of HOSTED_NUMBERS) {
    const value = parseWholeNumber(env[name], pricing[key], min)
    if (value === undefined) return undefined
    pricing[key] = value
  }
  return pricing
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function hostedPricingProblems(env) {
  return HOSTED_NUMBERS.filter(
    ({ name, key, min }) =>
      parseWholeNumber(env[name], HOSTED_PRICING_DEFAULTS[key], min) ===
      undefined,
  ).map(
    ({ name, min }) =>
      `${name} muss eine ganze Zahl ab ${min} sein: "${env[name]?.trim()}"`,
  )
}

// Part of an address (/agb/<version>, /avv/<version>): letters, digits,
// dots, hyphens and underscores, starting with a letter or digit
const TERMS_VERSION = /^[A-Za-z0-9][\w.-]{0,63}$/

/**
 * HOSTED_TERMS_VERSION: what the operator calls the terms an account agrees
 * to with its first Kita, e.g. `2026-10`. Stored with the agreement, and the
 * texts under it (src/lib/hosted/terms.ts); a new value asks every owner to
 * agree again.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} undefined when unset, or not at most 64
 *   letters, digits, dots, hyphens and underscores
 */
export function parseTermsVersion(raw) {
  const value = (raw ?? '').trim()
  return TERMS_VERSION.test(value) ? value : undefined
}

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * HOSTED_OPERATOR_EMAIL and OPERATOR_EMAIL: where the hosted instance sends
 * the invoice requests of its accounts, and the contact every mail names.
 * Both end up verbatim in mails, so they are held to the plain-text rules as
 * well: no control or bidi character.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} undefined when unset or no address
 */
export function parseOperatorEmail(raw) {
  const value = (raw ?? '').trim()
  return EMAIL_ADDRESS.test(value) && !FORBIDDEN_SINGLE_LINE.test(value)
    ? value
    : undefined
}

// Who runs the instance, for the footer of every mail it sends
// (src/lib/mail/footer.ts): OPERATOR_NAME, OPERATOR_ADDRESS, OPERATOR_EMAIL
// and OPERATOR_LEGAL_INFO, what a business letter of the operator's legal
// form has to name besides (register, representatives, VAT ID …).
//
// An environment variable is one line on most of the ways it gets there
// (compose's `${…}`, `docker run -e`, a systemd unit), so the lines of the
// address and of the legal information are separated by `|`. A line break
// that does arrive counts as one as well.
const LINE_SEPARATOR = /\||\r?\n/

/**
 * @typedef {{ maxLines: number, maxLength: number, links: boolean }} LineRules
 */

/** @type {Readonly<Record<'name' | 'address' | 'legalInfo', LineRules>>} */
const OPERATOR_LINES = /* @__PURE__ */ Object.freeze({
  name: { maxLines: 1, maxLength: 120, links: false },
  address: { maxLines: 5, maxLength: 100, links: false },
  legalInfo: { maxLines: 8, maxLength: 200, links: true },
})

/**
 * Lines of plain text, held to the rules of everything a person typed: no
 * control or bidi character, something visible in every line. Empty lines
 * fall away.
 *
 * @param {string | undefined} raw
 * @param {LineRules} rules
 * @returns {string[] | undefined} [] when unset; undefined for too many or
 *   too long lines, a line nothing visible is in, or a link where none may be
 */
function parseLines(raw, { maxLines, maxLength, links }) {
  const value = (raw ?? '').trim()
  if (value === '') return []
  const lines = value
    .split(LINE_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const plain =
    lines.length > 0 &&
    lines.length <= maxLines &&
    lines.every(
      (line) =>
        line.length <= maxLength &&
        !FORBIDDEN_SINGLE_LINE.test(line) &&
        VISIBLE.test(line) &&
        (links || !LOOKS_LIKE_LINK.test(line)),
    )
  return plain ? lines : undefined
}

/**
 * OPERATOR_NAME: the person or organisation that runs the instance.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} '' when unset; undefined for more than a
 *   line, more than 120 characters, nothing visible or a link
 */
export function parseOperatorName(raw) {
  return parseLines(raw, OPERATOR_LINES.name)?.join('')
}

/**
 * OPERATOR_ADDRESS: the postal address, lines separated by `|`.
 *
 * @param {string | undefined} raw
 * @returns {string[] | undefined} [] when unset; undefined for more than 5
 *   lines, a line over 100 characters, or a link
 */
export function parseOperatorAddress(raw) {
  return parseLines(raw, OPERATOR_LINES.address)
}

/**
 * OPERATOR_LEGAL_INFO: free text in lines separated by `|`, whatever the
 * operator's legal form requires in a business letter.
 *
 * @param {string | undefined} raw
 * @returns {string[] | undefined} [] when unset; undefined for more than 8
 *   lines or a line over 200 characters
 */
export function parseOperatorLegalInfo(raw) {
  return parseLines(raw, OPERATOR_LINES.legalInfo)
}

/**
 * Who runs the instance, as the footer of a mail names it. Every part may
 * be empty; with HOSTED=true the first three can't be (below).
 *
 * @typedef {{ name: string, address: string[], email: string, legalInfo: string[] }} OperatorDetails
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {OperatorDetails | undefined} undefined when one of them is invalid
 */
export function parseOperatorDetails(env) {
  const name = parseOperatorName(env.OPERATOR_NAME)
  const address = parseOperatorAddress(env.OPERATOR_ADDRESS)
  const email = env.OPERATOR_EMAIL?.trim()
    ? parseOperatorEmail(env.OPERATOR_EMAIL)
    : ''
  const legalInfo = parseOperatorLegalInfo(env.OPERATOR_LEGAL_INFO)
  if (
    name === undefined ||
    address === undefined ||
    email === undefined ||
    legalInfo === undefined
  ) {
    return undefined
  }
  return { name, address, email, legalInfo }
}

/**
 * What a value held to these rules has to look like, in the words of the
 * start-up check.
 *
 * @param {LineRules} rules
 */
function linesShape({ maxLines, maxLength, links }) {
  const lines =
    maxLines === 1
      ? `eine Zeile mit höchstens ${maxLength} Zeichen`
      : `höchstens ${maxLines} Zeilen (getrennt durch |) mit je höchstens ${maxLength} Zeichen`
  return links ? lines : `${lines} ohne Link`
}

// The parts a footer can't do without. The hosted instance refuses to start
// without them (below); any other instance warns once at start-up.
const OPERATOR_REQUIRED = /** @type {const} */ ([
  {
    name: 'OPERATOR_NAME',
    key: 'name',
    parse: parseOperatorName,
    shape: linesShape(OPERATOR_LINES.name),
  },
  {
    name: 'OPERATOR_ADDRESS',
    key: 'address',
    parse: parseOperatorAddress,
    shape: linesShape(OPERATOR_LINES.address),
  },
  {
    name: 'OPERATOR_EMAIL',
    key: 'email',
    parse: parseOperatorEmail,
    shape: 'eine E-Mail-Adresse',
  },
])

/**
 * The names of the required operator details that are not set.
 *
 * @param {Pick<OperatorDetails, 'name' | 'address' | 'email'>} details
 * @returns {string[]}
 */
export function missingOperatorDetails(details) {
  return OPERATOR_REQUIRED.filter(({ key }) => details[key].length === 0).map(
    ({ name }) => name,
  )
}

/**
 * IMPRESSUM_URL, DATENSCHUTZ_URL, AGB_URL and AVV_URL: the operator's own
 * pages, which the routes redirect to and mails link — every mail the first
 * two, the confirmation of an agreement the terms (src/lib/hosted/terms.ts).
 * A mail has no page to be relative to, so they have to be complete
 * addresses, and over HTTPS. Unset is fine: the instance's own pages stand
 * in.
 *
 * @param {string | undefined} raw
 * @returns {string | undefined} '' when unset; undefined for anything that
 *   is no https:// address
 */
export function parseLegalUrl(raw) {
  const value = (raw ?? '').trim()
  if (value === '') return ''
  const url = parseWebUrl(value, '')
  return url?.startsWith('https://') ? url : undefined
}

const LEGAL_URLS = /** @type {const} */ ([
  'IMPRESSUM_URL',
  'DATENSCHUTZ_URL',
  'AGB_URL',
  'AVV_URL',
])

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function operatorProblems(env) {
  const problems = []
  if (parseOperatorLegalInfo(env.OPERATOR_LEGAL_INFO) === undefined) {
    problems.push(
      `OPERATOR_LEGAL_INFO muss ${linesShape(OPERATOR_LINES.legalInfo)} haben: "${env.OPERATOR_LEGAL_INFO?.trim()}"`,
    )
  }
  for (const name of LEGAL_URLS) {
    if (parseLegalUrl(env[name]) === undefined) {
      problems.push(
        `${name} muss eine Adresse mit https:// sein: "${env[name]?.trim()}"`,
      )
    }
  }
  return problems
}

// What the hosted instance can't run without, and what each has to look like
const HOSTED_REQUIRED = /** @type {const} */ ([
  {
    name: 'HOSTED_TERMS_VERSION',
    parse: parseTermsVersion,
    shape:
      'eine Kennung aus höchstens 64 Buchstaben, Ziffern, Punkten, Binde- oder Unterstrichen',
  },
  {
    name: 'HOSTED_OPERATOR_EMAIL',
    parse: parseOperatorEmail,
    shape: 'eine E-Mail-Adresse',
  },
  ...OPERATOR_REQUIRED,
])

/**
 * HOSTED_TERMS_VERSION, HOSTED_OPERATOR_EMAIL and the operator details every
 * mail names. All of them have to be there with HOSTED=true; a value nobody
 * can parse is a typo either way.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function hostedRequiredProblems(env) {
  const hosted = parseHosted(env.HOSTED) === true
  /** @type {string[]} */
  const problems = []
  for (const { name, parse, shape } of HOSTED_REQUIRED) {
    const value = env[name]?.trim() ?? ''
    if (value === '') {
      if (hosted) problems.push(`${name} fehlt (Pflicht mit HOSTED=true)`)
    } else if (parse(value) === undefined) {
      problems.push(`${name} muss ${shape} sein: "${value}"`)
    }
  }
  return problems
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function signupProblems(env) {
  const problems = []
  if (!parseSignupMode(env.SIGNUP_MODE)) {
    problems.push(
      `SIGNUP_MODE muss open oder closed sein: "${env.SIGNUP_MODE?.trim()}"`,
    )
  }
  const { invalid } = parseEmailDomains(env.SIGNUP_EMAIL_DOMAINS)
  if (invalid.length) {
    problems.push(invalidEmailDomainsProblem(invalid))
  }
  return problems
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function hostedProblems(env) {
  const problems = []
  if (parseHosted(env.HOSTED) === undefined) {
    problems.push(`HOSTED muss true oder false sein: "${env.HOSTED?.trim()}"`)
  }
  if (!parseDocsUrl(env.DOCS_URL)) {
    problems.push(
      `DOCS_URL muss eine Adresse mit http:// oder https:// sein: "${env.DOCS_URL?.trim()}"`,
    )
  }
  if (!parseSourceUrl(env.SOURCE_URL)) {
    problems.push(
      `SOURCE_URL muss eine Adresse mit http:// oder https:// sein: "${env.SOURCE_URL?.trim()}"`,
    )
  }
  if (parsePriceNote(env.HOSTED_PRICE_NOTE) === undefined) {
    problems.push(
      `HOSTED_PRICE_NOTE muss eine Zeile mit höchstens ${PRICE_NOTE_MAX} Zeichen ohne Link sein: "${env.HOSTED_PRICE_NOTE?.trim()}"`,
    )
  }
  return [...problems, ...hostedRequiredProblems(env)]
}

/**
 * PLAUSIBLE_DOMAIN and PLAUSIBLE_URL, checked whether or not the instance is
 * hosted, like DOCS_URL
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function plausibleProblems(env) {
  const problems = []
  if (parsePlausibleDomain(env.PLAUSIBLE_DOMAIN) === undefined) {
    problems.push(
      `PLAUSIBLE_DOMAIN muss ein Domainname sein, wie er in Plausible eingetragen ist: "${env.PLAUSIBLE_DOMAIN?.trim()}"`,
    )
  }
  if (!parsePlausibleUrl(env.PLAUSIBLE_URL)) {
    problems.push(
      `PLAUSIBLE_URL muss eine Adresse mit http:// oder https:// sein, ohne Zugangsdaten, Query und Fragment: "${env.PLAUSIBLE_URL?.trim()}"`,
    )
  }
  return problems
}

/**
 * What is wrong with these variables, in the words of the start-up check
 * (scripts/server.mjs). Empty when all of them are fine.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function instanceConfigProblems(env) {
  return [
    ...signupProblems(env),
    ...hostedProblems(env),
    ...hostedPricingProblems(env),
    ...plausibleProblems(env),
    ...operatorProblems(env),
  ]
}
