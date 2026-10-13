// Entry point for the container (and `bun run preview`).
//
// @astrojs/node's standalone server starts itself on import and installs no
// signal handlers, so a SIGTERM would cut running requests. Starting it by
// hand gives us the http.Server, which the app then shuts down gracefully
// (src/lib/server/runtime.ts).
//
// The image copies this file and instance-config.mjs next to dist/ and
// node_modules/, so it imports nothing from src/ — only that one neighbour
// and packages the app depends on anyway.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { findInvalidTrustedProxies } from '@better-auth/core/utils/ip'

import { instanceConfigProblems, parseHosted } from './instance-config.mjs'

const REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function missing(env) {
  return REQUIRED.filter((name) => !env[name]?.trim()).map(
    (name) => `${name} fehlt`,
  )
}

// Better Auth signs sessions and links with it
function weakSecret(env) {
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? ''
  return secret && secret.length < 32
    ? ['BETTER_AUTH_SECRET ist kürzer als 32 Zeichen']
    : []
}

// Session cookies and the links in every mail depend on it: outside a local
// test it has to be HTTPS
function insecureUrl(env) {
  const value = env.BETTER_AUTH_URL?.trim()
  if (!value) return []
  let url
  try {
    url = new URL(value)
  } catch {
    return ['BETTER_AUTH_URL ist keine gültige Adresse']
  }
  if (url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname)) return []
  return ['BETTER_AUTH_URL muss mit https:// beginnen']
}

// IPs or CIDR ranges, as in docs/selbst-hosten/spam-schutz.md, checked by the
// same parser Better Auth uses. An entry nobody can parse would silently trust
// nothing — or not the proxy that was meant.
function invalidProxies(env) {
  const entries = (env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const invalid = findInvalidTrustedProxies(entries)
  return invalid.length
    ? [`TRUSTED_PROXIES enthält ungültige Einträge: ${invalid.join(', ')}`]
    : []
}

const VAPID = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']

// The uncompressed P-256 point, 65 bytes in base64url
function vapidPublicKey(value) {
  if (!/^[\w-]{87}$/.test(value)) return undefined
  const point = Buffer.from(value, 'base64url')
  return point.length === 65 && point[0] === 4 ? point : undefined
}

// The JWK `bunx @pushforge/builder vapid` prints; its x and y are the public
// key's coordinates
function vapidPrivateKey(value) {
  try {
    const jwk = JSON.parse(value)
    const complete = ['x', 'y', 'd'].every(
      (part) => typeof jwk?.[part] === 'string',
    )
    return jwk?.kty === 'EC' && jwk.crv === 'P-256' && complete
      ? jwk
      : undefined
  } catch {
    return undefined
  }
}

// A mismatched pair would pass every other check, and every push service
// would then turn every message away
function vapidKeyProblems(env) {
  const point = vapidPublicKey(env.VAPID_PUBLIC_KEY.trim())
  const jwk = vapidPrivateKey(env.VAPID_PRIVATE_KEY.trim())
  const problems = []
  if (!point) {
    problems.push(
      'VAPID_PUBLIC_KEY ist kein öffentlicher P-256-Schlüssel (87 Zeichen base64url)',
    )
  }
  if (!jwk) {
    problems.push('VAPID_PRIVATE_KEY ist kein P-256-Schlüssel im JWK-Format')
  }
  if (problems.length) return problems
  const matches =
    point.subarray(1, 33).toString('base64url') === jwk.x &&
    point.subarray(33).toString('base64url') === jwk.y
  return matches ? [] : ['VAPID_PUBLIC_KEY passt nicht zu VAPID_PRIVATE_KEY']
}

// Web push is optional, but only as a whole: a half-configured one would
// hand out subscriptions nobody can ever send to
function vapidProblems(env) {
  const unset = VAPID.filter((name) => !env[name]?.trim())
  if (unset.length === VAPID.length) return []
  if (unset.length) {
    return [
      `Web-Push braucht alle drei VAPID-Variablen, es fehlt: ${unset.join(', ')}`,
    ]
  }
  const problems = vapidKeyProblems(env)
  if (!/^(mailto|https):/.test(env.VAPID_SUBJECT.trim())) {
    problems.push('VAPID_SUBJECT muss mit mailto: oder https: beginnen')
  }
  return problems
}

// The hosted instance reminds its accounts of a trial that ends and tells the
// operator about an invoice somebody asked for. Without a mail server it
// would pause Kitas nobody ever warned. Checked here and not with the other
// instance rules: `astro dev` logs its mails and may well run hosted.
function hostedSmtpProblems(env) {
  return parseHosted(env.HOSTED) === true && !env.SMTP_HOST?.trim()
    ? [
        'HOSTED=true braucht SMTP_HOST (Erinnerungen und Rechnungen gehen per Mail)',
      ]
    : []
}

// The imprint and the privacy policy every mail links, and what an account
// of the hosted instance agrees to with its first Kita: the terms and the
// data processing agreement. Each as an address of the operator's website or
// as a Markdown file in LEGAL_DIR (src/lib/legal.ts). Without them the mails
// and the form would link to a page that says nothing. Checked here for the
// same reason as the mail server: it takes the file system, and `astro dev`
// gets by with the page that says so. A self-hosted instance is only warned
// at start-up (logOperatorConfiguration in src/lib/mail/footer.ts).
const HOSTED_LEGAL = [
  { page: 'impressum', url: 'IMPRESSUM_URL', what: 'ein Impressum' },
  {
    page: 'datenschutz',
    url: 'DATENSCHUTZ_URL',
    what: 'eine Datenschutzerklärung',
  },
  { page: 'agb', url: 'AGB_URL', what: 'die AGB' },
  { page: 'avv', url: 'AVV_URL', what: 'den AV-Vertrag' },
]

export function hostedLegalProblems(env) {
  if (parseHosted(env.HOSTED) !== true) return []
  const directory = env.LEGAL_DIR?.trim() || './legal'
  return HOSTED_LEGAL.filter(
    ({ page, url }) =>
      !env[url]?.trim() && !existsSync(join(directory, `${page}.md`)),
  ).map(
    ({ page, url, what }) =>
      `HOSTED=true braucht ${what}: ${url} setzen oder ${page}.md in LEGAL_DIR (${directory}) hinterlegen`,
  )
}

// What is missing or wrong in a way the app would only notice at the first
// sign-in or mail. Empty when the server may start.
export function configurationProblems(env) {
  return [
    ...missing(env),
    ...weakSecret(env),
    ...insecureUrl(env),
    ...invalidProxies(env),
    ...vapidProblems(env),
    // SIGNUP_MODE and SIGNUP_EMAIL_DOMAINS: a typo must not open a sign-up
    // that was meant to be closed. HOSTED, DOCS_URL, the HOSTED_* and the
    // PLAUSIBLE_* settings ride along.
    ...instanceConfigProblems(env),
    ...hostedSmtpProblems(env),
    ...hostedLegalProblems(env),
  ]
}

async function main() {
  const problems = configurationProblems(process.env)
  if (problems.length) {
    for (const problem of problems) console.error(`[server] ${problem}`)
    console.error(
      '[server] Kibo startet nicht. Siehe docs/selbst-hosten/einrichtung.md.',
    )
    process.exit(1)
  }

  process.env.ASTRO_NODE_AUTOSTART = 'disabled'
  const entry = pathToFileURL(resolve('dist/server/entry.mjs'))
  const { startServer } = await import(entry.href)
  const { server } = startServer()

  // The Astro bundle cannot import this file, so the handle is handed over
  // through a well-known symbol. Same name in src/lib/server/runtime.ts.
  globalThis[Symbol.for('kibo.httpServer')] = server.server

  // The app's start-up hook (signal handlers, the hourly housekeeping, the
  // SMTP log) comes with the middleware, which Astro only loads with the first
  // request. Loading it now, from the URL the bundle's manifest uses, starts
  // it with the server instead of with the first visitor — once, since both
  // imports get the same module. The hook can refuse to run, too: the hosted
  // instance stops when the terms under HOSTED_TERMS_VERSION read differently
  // from the ones stored under it (src/lib/hosted/terms.ts).
  try {
    await import(
      pathToFileURL(resolve('dist/server/virtual_astro_middleware.mjs')).href
    )
  } catch (error) {
    // The reason only, as everywhere in the app (src/lib/error-message.ts)
    const reason = error instanceof Error ? error.message : 'unbekannter Fehler'
    console.error(`[server] Kibo startet nicht: ${reason}`)
    process.exit(1)
  }
}

// Run as a program; imported (by tests/server-config.test.ts) it only
// provides the checks
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  await main()
}
