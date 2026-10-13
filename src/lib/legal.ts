import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  AGB_URL,
  AVV_URL,
  BETTER_AUTH_URL,
  DATENSCHUTZ_URL,
  IMPRESSUM_URL,
  LEGAL_DIR,
} from 'astro:env/server'
import type { AstroGlobal } from 'astro'
import { marked } from 'marked'

import { errorMessage } from '@/lib/error-message'
import { hostedContact, instanceMode } from '@/lib/instance'

import { parseLegalUrl } from '../../scripts/instance-config.mjs'

// The names are also the routes: /impressum and /datenschutz on every
// instance, /agb and /avv — the terms and the data processing agreement an
// account agrees to — on the hosted one only
export type LegalPage = 'impressum' | 'datenschutz' | 'agb' | 'avv'

interface LegalPageSetup {
  // The heading of the page, and what the footer calls it
  title: string
  footer: string
  // The address of the operator's own page, which the route then redirects to
  url: string | undefined
  // Without HOSTED there is no contract to agree to, and no page for it
  hostedOnly?: true
}

// Every instance is run by somebody else, so the pages are theirs to fill:
// either an address on their own website or a Markdown file mounted into the
// container (see deploy/legal/). Read once; objects, so the tests can point
// the pages somewhere else in place.
export const legalPages: Record<LegalPage, LegalPageSetup> = {
  impressum: { title: 'Impressum', footer: 'Impressum', url: IMPRESSUM_URL },
  datenschutz: {
    title: 'Datenschutzerklärung',
    footer: 'Datenschutz',
    url: DATENSCHUTZ_URL,
  },
  agb: {
    title: 'Allgemeine Geschäftsbedingungen',
    footer: 'AGB',
    url: AGB_URL,
    hostedOnly: true,
  },
  avv: {
    title: 'Vertrag zur Auftragsverarbeitung',
    footer: 'AV-Vertrag',
    url: AVV_URL,
    hostedOnly: true,
  },
}

export const legalSources = { directory: LEGAL_DIR }

function hasLegalPage(page: LegalPage) {
  return instanceMode.hosted || !legalPages[page].hostedOnly
}

// The operator's own page, if there is one. The addresses are checked at
// start-up (scripts/instance-config.mjs), and read here the same way: the
// normalised https:// address the check accepted, so a mail, a redirect and
// the check never disagree; a value the check rejects — which only the dev
// server lets through — leaves the instance's own page.
export function legalUrl(page: LegalPage) {
  return parseLegalUrl(legalPages[page].url) || undefined
}

// Whether the page has anything to show: the operator's own address, or a
// file in LEGAL_DIR. Without either it only says that it isn't filled in yet
// — and so does every link to it, the ones in each mail included. The
// hosted instance doesn't start that way (scripts/server.mjs); any other is
// warned at start-up (logOperatorConfiguration in src/lib/mail/footer.ts).
export function isLegalPageFilledIn(page: LegalPage) {
  return legalUrl(page) !== undefined || existsSync(legalFilePath(page))
}

export function legalHref(page: LegalPage) {
  return legalUrl(page) ?? `/${page}`
}

// For a mail, which has no page to be relative to: the operator's own page
// (normalised by legalUrl), otherwise this instance's own under
// BETTER_AUTH_URL. Either is reachable without signing in.
export function absoluteLegalHref(page: LegalPage) {
  return legalUrl(page) ?? new URL(`/${page}`, BETTER_AUTH_URL).href
}

// The two documents an account of the hosted instance agrees to
export type TermsPage = Extract<LegalPage, 'agb' | 'avv'>

export const TERMS_PAGES: readonly TermsPage[] = ['agb', 'avv']

// Where one version of the terms or of the data processing agreement can be
// read for good: /agb/<version> on this instance, which shows the text stored
// under it (src/lib/hosted/terms.ts) — or, where the operator publishes the
// document on their own website (AGB_URL, AVV_URL), that address: keeping
// its old versions is then theirs to do. HOSTED_TERMS_VERSION is held to
// characters an address takes as they are.
function termsHref(page: TermsPage, version: string) {
  return legalUrl(page) ?? `/${page}/${version}`
}

// The same for a mail
export function absoluteTermsHref(page: TermsPage, version: string) {
  return new URL(termsHref(page, version), BETTER_AUTH_URL).href
}

// What the box for the terms links to (src/components/auth/TermsField.vue):
// the exact version that is agreed to by ticking it, and its name
export function termsLinks() {
  const version = hostedContact.termsVersion
  return {
    agbHref: termsHref('agb', version),
    avvHref: termsHref('avv', version),
    version,
  }
}

// What the footer of every layout links (src/components/LegalLinks.astro)
export function legalFooterLinks() {
  return (Object.keys(legalPages) as LegalPage[])
    .filter(hasLegalPage)
    .map((page) => ({ href: legalHref(page), label: legalPages[page].footer }))
}

// Rendered once per process and file: the files are mounted read-only and
// change with a deployment, not while the container runs. A file that can't
// be read is not cached, so fixing the mount takes effect without a restart.
const rendered = new Map<string, string>()
// Warned once per file, not on every visit
const warned = new Set<string>()

// What of a file is published: the templates carry their instructions in
// HTML comments, and nobody needs to read those in the page source of a
// published imprint. This is also what a version of the terms stores
// (src/lib/hosted/terms.ts), so editing a comment changes no version — nor
// do the blank lines a removed comment leaves, line endings or blanks at the
// end of a line, none of which the rendered page shows.
export function publishedMarkdown(markdown: string) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function legalFilePath(page: LegalPage) {
  return join(legalSources.directory, `${page}.md`)
}

// The content comes from the operator, not from visitors, so HTML in it is
// as trusted as the rest of the file. breaks: addresses are written line by
// line and are meant to stay that way.
export function renderLegalMarkdown(markdown: string) {
  return marked.parse(markdown, { async: true, breaks: true })
}

async function renderFile(page: LegalPage, path: string) {
  try {
    const markdown = await readFile(path, 'utf8')
    return await renderLegalMarkdown(publishedMarkdown(markdown))
  } catch (error) {
    if (!warned.has(path)) {
      warned.add(path)
      console.warn(
        `[legal] ${path} nicht lesbar, /${page} zeigt nur einen Hinweis:`,
        errorMessage(error),
      )
    }
    return undefined
  }
}

// The page's HTML, or undefined when the operator hasn't filled it in yet
async function legalContent(page: LegalPage) {
  const path = legalFilePath(page)
  const cached = rendered.get(path)
  if (cached !== undefined) return cached
  const html = await renderFile(page, path)
  if (html !== undefined) rendered.set(path, html)
  return html
}

// What a legal page answers with: the operator's own page, or the mounted
// Markdown — without content when nothing is mounted: the page then says so
// (src/layouts/Legal.astro) instead of pretending to exist. Undefined for a
// page this instance doesn't have at all — the terms without HOSTED.
export type LegalAnswer =
  { redirect: string } | { content: string | undefined } | undefined

export async function legalPageResponse(page: LegalPage): Promise<LegalAnswer> {
  if (!hasLegalPage(page)) return undefined
  const redirect = legalUrl(page)
  if (redirect) return { redirect }
  return { content: await legalContent(page) }
}

// What a page makes of such an answer (src/pages/agb.astro and its
// neighbours, the versions of the terms in src/pages/agb/): the redirect for
// the page to return, or what the layout renders. Only the page itself can
// set the status, a layout is rendered too late for that — 404 when the
// layout has nothing to show but that the page isn't filled in, and for a
// page this instance doesn't have, which answers exactly like an address
// that doesn't exist, reason phrase included.
export function answerLegalPage(
  astro: Pick<AstroGlobal, 'redirect' | 'response'>,
  legal: LegalAnswer,
) {
  if (legal && 'redirect' in legal) return astro.redirect(legal.redirect, 302)
  if (!legal?.content) {
    astro.response.status = 404
    astro.response.statusText = 'Not Found'
  }
  return legal
}

export async function serveLegalPage(
  astro: Pick<AstroGlobal, 'redirect' | 'response'>,
  page: LegalPage,
) {
  return answerLegalPage(astro, await legalPageResponse(page))
}
