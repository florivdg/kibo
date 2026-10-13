import { readFile } from 'node:fs/promises'

import type { AstroGlobal } from 'astro'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { legalTermsVersion } from '@/db/schema'
import type { Executor } from '@/db/types'
import { dateAndTime } from '@/lib/board/time'
import { errorMessage } from '@/lib/error-message'
import { hostedContact, instanceMode, operatorDetails } from '@/lib/instance'
import {
  absoluteTermsHref,
  answerLegalPage,
  legalFilePath,
  legalPageResponse,
  legalUrl,
  publishedMarkdown,
  renderLegalMarkdown,
  TERMS_PAGES,
  type LegalAnswer,
  type TermsPage,
} from '@/lib/legal'
import type { MailDetail } from '@/lib/mail/details'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import { termsConfirmationMail } from '@/lib/mail/templates'
import { allowAuthMail } from '@/lib/spam/guard'

import { parseTermsVersion } from '../../../scripts/instance-config.mjs'

import type { TermsAcceptance } from './subscriptions'

// The versions of the terms and the data processing agreement of the hosted
// instance. An account agrees to one version (HOSTED_TERMS_VERSION, stored
// with its subscription); the text of that version is kept in the database
// (legal_terms_version) and stays readable at /agb/<version> and
// /avv/<version> for good, whatever agb.md and avv.md say later. After the
// agreement the account gets a mail that records it and links both texts.

// What a version consists of: the published part of agb.md and avv.md in
// LEGAL_DIR (publishedMarkdown), null for a document the operator publishes
// under AGB_URL / AVV_URL instead — there is nothing to keep of it here.
type TermsTexts = Record<TermsPage, string | null>

function isMissingFile(error: unknown) {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
}

// Undefined when the file isn't there
async function publishedFile(page: TermsPage) {
  try {
    return publishedMarkdown(await readFile(legalFilePath(page), 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

// The texts as the server finds them now. Undefined when a document has
// neither an address nor a file — the hosted instance doesn't start that way
// (hostedLegalProblems in scripts/server.mjs), the dev server shows a page
// that says so, and there is nothing to keep.
async function currentTexts(): Promise<TermsTexts | undefined> {
  const texts: TermsTexts = { agb: null, avv: null }
  for (const page of TERMS_PAGES) {
    if (legalUrl(page)) continue
    const text = await publishedFile(page)
    if (text === undefined) return undefined
    texts[page] = text
  }
  return texts
}

// A version that is stored is never changed: whoever agreed to it agreed to
// that text. A file that reads differently under the same version — or that
// takes the place of the address the version was published under — has to
// come with a new HOSTED_TERMS_VERSION.
function conflict(version: string, pages: TermsPage[]) {
  const files = pages.map((page) => `${page}.md`).join(' und ')
  return new Error(
    `HOSTED_TERMS_VERSION "${version}" ist bereits mit einem anderen Text von ${files} gespeichert. ` +
      'Wer AGB oder AV-Vertrag ändert, setzt eine neue HOSTED_TERMS_VERSION – jede Fassung, der ein Konto zugestimmt hat, muss unverändert abrufbar bleiben.',
  )
}

// Stores the version with these texts unless it is stored already — two
// processes starting at once store one row — and reads what it is stored
// with
async function claimVersion(on: Executor, version: string, texts: TermsTexts) {
  const created = await on
    .insert(legalTermsVersion)
    .values({ version, ...texts })
    .onConflictDoNothing()
    .returning({ version: legalTermsVersion.version })
  const [stored] = await on
    .select({ agb: legalTermsVersion.agb, avv: legalTermsVersion.avv })
    .from(legalTermsVersion)
    .where(eq(legalTermsVersion.version, version))
  return { created: created.length > 0, stored }
}

// Called once at start-up (src/lib/server/runtime.ts), before anything else:
// stores the current version's texts if the version is new, and throws if
// it is stored with a different text — or if that can't be checked, since
// the start then can't vouch for the version either. The server doesn't run
// either way (scripts/server.mjs). Returns whether the version was stored
// now. Without HOSTED nothing touches the database.
export async function storeTermsVersion(on: Executor = db) {
  if (!instanceMode.hosted) return false
  const version = hostedContact.termsVersion
  let found
  try {
    const texts = await currentTexts()
    found = texts && { texts, ...(await claimVersion(on, version, texts)) }
  } catch (error) {
    throw new Error(
      `AGB und AV-Vertrag der HOSTED_TERMS_VERSION "${version}" nicht prüfbar: ${errorMessage(error)}`,
    )
  }
  if (!found) {
    console.warn(
      `[legal] AGB oder AV-Vertrag fehlen: Fassung "${version}" nicht gespeichert`,
    )
    return false
  }
  const { texts, created, stored } = found
  const changed = TERMS_PAGES.filter(
    (page) => texts[page] !== null && stored?.[page] !== texts[page],
  )
  if (changed.length) throw conflict(version, changed)
  if (created) {
    console.info(
      `[legal] AGB und AV-Vertrag als Fassung "${version}" gespeichert`,
    )
  }
  return created
}

// A stored version is never changed, so its page is rendered once per
// process
const renderedVersions = new Map<string, string>()

// What /agb/<version> and /avv/<version> answer with: the stored text of
// that version. The current version without a stored text — a document under
// its address, or the dev server that had nothing to store — answers like
// /agb and /avv. Any other version, and either page without HOSTED, is an
// address that doesn't exist.
export async function termsVersionResponse(
  page: TermsPage,
  version: string,
): Promise<LegalAnswer> {
  if (!instanceMode.hosted || parseTermsVersion(version) !== version) {
    return undefined
  }
  const key = `${page}/${version}`
  const cached = renderedVersions.get(key)
  if (cached !== undefined) return { content: cached }
  const [row] = await db
    .select({ text: legalTermsVersion[page] })
    .from(legalTermsVersion)
    .where(eq(legalTermsVersion.version, version))
  if (row?.text) {
    const html = await renderLegalMarkdown(row.text)
    renderedVersions.set(key, html)
    return { content: html }
  }
  return version === hostedContact.termsVersion
    ? legalPageResponse(page)
    : undefined
}

// For src/pages/agb/[version].astro and its neighbour, like serveLegalPage
export async function serveTermsVersion(
  astro: Pick<AstroGlobal, 'redirect' | 'response'>,
  page: TermsPage,
  version: string,
) {
  return answerLegalPage(astro, await termsVersionResponse(page, version))
}

// How the confirmation goes out. An object, so the tests can read it
// instead.
export const termsMails: { send: (mail: Mail) => Promise<unknown> } = {
  send: sendMail,
}

export interface TermsConfirmation {
  // Who agreed: the account, which the mail goes to
  account: { name: string; email: string }
  // What it agreed for: the Kita it created, or who the invoice goes to
  party: MailDetail
  terms: TermsAcceptance
  request?: Request
}

// The lines of the mail: both parties, the version, the moment in Berlin
// and the two texts in that version, as absolute addresses
function confirmationDetails({
  account,
  party,
  terms,
}: TermsConfirmation): MailDetail[] {
  const { name, address } = operatorDetails
  const { termsVersion: version, termsAcceptedAt } = terms
  return [
    { label: 'Anbieter', value: [name, ...address].join('\n') },
    { label: 'Konto', value: `${account.name} (${account.email})` },
    party,
    { label: 'Fassung', value: version },
    {
      label: 'Zugestimmt am',
      value: `${dateAndTime(termsAcceptedAt)} Uhr (deutsche Zeit)`,
    },
    { label: 'AGB', value: absoluteTermsHref('agb', version), link: true },
    {
      label: 'AV-Vertrag',
      value: absoluteTermsHref('avv', version),
      link: true,
    },
  ]
}

// After the account agreed: with its first Kita (src/lib/auth.ts), or with
// an invoice request that records a version it hadn't agreed to
// (src/actions/subscription.ts). The agreement is stored by then; the mail
// records it for the account. Counted against the `invoice` mail budgets of
// the account's address; a refusal or a failed delivery is logged and not
// tried again. Never throws.
export async function sendTermsConfirmation(confirmation: TermsConfirmation) {
  const { account, request } = confirmation
  try {
    if (!(await allowAuthMail(account.email, 'invoice', request))) return
    await termsMails.send({
      to: account.email,
      ...termsConfirmationMail(account.name, confirmationDetails(confirmation)),
    })
  } catch (error) {
    console.error(
      `[hosted] Bestätigung der AGB nicht verschickt: ${errorMessage(error)}`,
    )
  }
}
