import { instanceMode, operatorDetails } from '@/lib/instance'
import {
  absoluteLegalHref,
  isLegalPageFilledIn,
  legalPages,
  legalSources,
} from '@/lib/legal'
import { INVITATION_TTL_DAYS } from '@/lib/limits'

import { missingOperatorDetails } from '../../../scripts/instance-config.mjs'

// What every mail says about who sends it, and what an invitation says about
// the address it went to. Read from the settings each time a mail is put
// together (operatorDetails in src/lib/instance.ts, the legal pages in
// src/lib/legal.ts), so the tests can change them in place. The layout that
// renders both is render() in src/lib/mail/templates.ts: whatever mail goes
// through it carries the footer.

interface FooterLink {
  label: string
  url: string
}

export interface MailFooter {
  // Who runs the instance, line by line: name, address, contact address —
  // whatever of it is set
  operator: string[]
  // What a business letter of the operator's legal form names besides
  legalInfo: string[]
  // Imprint and privacy policy, absolute: a mail has no page to be relative to
  links: FooterLink[]
}

// The pages every mail links
const MAIL_LEGAL_PAGES = ['impressum', 'datenschutz'] as const

export function mailFooter(): MailFooter {
  const { name, address, email, legalInfo } = operatorDetails
  return {
    operator: [name, ...address, email && `E-Mail: ${email}`].filter(Boolean),
    legalInfo,
    links: MAIL_LEGAL_PAGES.map((page) => ({
      label: legalPages[page].footer,
      url: absoluteLegalHref(page),
    })),
  }
}

// A short paragraph above the signature, with a link to where the rest is
export interface MailNotice {
  title: string
  text: string
  link: FooterLink
}

// An invitation goes to an address the owner of a Kita typed in, which may
// belong to someone who never heard of Kibo (Art. 14 GDPR): where the address
// came from, what it is for, who is responsible, how long it is kept and whom
// to tell about an invitation nobody wanted. Who is responsible depends on
// what the instance is: on the hosted one the Kita invites in its own
// interest and the operator processes on its behalf, under the data
// processing agreement every account agrees to (/avv). A self-hosted
// instance has no such agreement — a Träger running Kibo for its own Kitas
// is responsible itself —, so the notice only names the operator as the one
// to turn to and leaves the legal relationship to the privacy policy. How
// long is what purgeInvitations (src/lib/organization-members.ts) does on the
// hourly run: an invitation that is answered, withdrawn or expired goes with
// the next one. Everything else is in the privacy policy the notice links.
export function invitationNotice(organizationName: string): MailNotice {
  const { name, email } = operatorDetails
  const operator = name
    ? `${name}, der Betreiber dieser Kibo-Instanz`
    : 'der Betreiber dieser Kibo-Instanz'
  const responsibility = instanceMode.hosted
    ? `Verantwortlich für diese Einladung ist die Kita „${organizationName}“; ${name ? `${operator},` : operator} verarbeitet Ihre Adresse dafür in ihrem Auftrag.`
    : `Ansprechpartner für den Datenschutz ist ${operator}.`
  const contact = email
    ? `Ist Ihnen die Einladung unerwünscht, schreiben Sie an ${email}.`
    : 'Ist Ihnen die Einladung unerwünscht, wenden Sie sich an den Betreiber; wie Sie ihn erreichen, steht im Impressum.'
  return {
    title: 'Datenschutzhinweis',
    text: [
      `Ihre E-Mail-Adresse hat die Inhaberin oder der Inhaber der Kita „${organizationName}“ eingegeben, um Sie zur Verwaltung der Kita einzuladen.`,
      responsibility,
      `Die Einladung mit Ihrer Adresse bleibt gespeichert, bis Sie sie annehmen oder ablehnen, die Kita sie zurückzieht oder sie nach ${INVITATION_TTL_DAYS} Tagen abläuft; danach wird sie beim nächsten stündlichen Aufräumen gelöscht.`,
      contact,
    ].join(' '),
    link: {
      label:
        'Ausführliche Informationen nach Art. 14 DSGVO stehen in der Datenschutzerklärung',
      url: absoluteLegalHref('datenschutz'),
    },
  }
}

// Once at start-up, next to the SMTP line. The hosted instance doesn't get
// here without name, address and e-mail (scripts/instance-config.mjs), nor
// without imprint and privacy policy (scripts/server.mjs); any other is told
// what its mails leave out, and which of the two pages they link would only
// say that it isn't filled in.
export function logOperatorConfiguration() {
  const missing = missingOperatorDetails(operatorDetails)
  if (missing.length === 0) {
    console.info(`[mail] Betreiber im Fuß der E-Mails: ${operatorDetails.name}`)
  } else {
    console.warn(
      `[mail] Betreiberangaben unvollständig, es fehlt: ${missing.join(', ')}. ` +
        'Der Fuß der E-Mails nennt nur, was gesetzt ist, und verlinkt Impressum und Datenschutz.',
    )
  }
  for (const page of MAIL_LEGAL_PAGES) {
    if (isLegalPageFilledIn(page)) continue
    console.warn(
      `[legal] Für /${page} ist weder ${page.toUpperCase()}_URL gesetzt noch ${page}.md in LEGAL_DIR (${legalSources.directory}) hinterlegt. ` +
        'Die Seite und der Link im Fuß jeder E-Mail zeigen nur einen Hinweis.',
    )
  }
}
