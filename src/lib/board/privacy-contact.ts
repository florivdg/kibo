import { EMAIL_MAX_LENGTH, PRIVACY_CONTACT_MAX } from '@/lib/limits'
import { isPlainText } from '@/lib/plain-text'

// Whom parents ask about data protection on the hosted instance, where the
// Kita answers for its boards (the operator only processes on its behalf):
// an e-mail address or an https:// link, set by the Kita's owner on
// /admin/kita (src/actions/kita.ts) and shown next to the Kita's name at the
// foot of its public pages (LegalFooter.astro). Shared by the action and the
// form, so both agree on what is accepted; nothing here imports server code.

// An address a mail program takes as it is: no spaces, quotes, commas or
// anything a mailto: link would read as more than the address
const EMAIL =
  /^[\w.+'-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i

// A web address that can only be a page: https, a host with a dot in it, no
// user name or password in front of it
function httpsLink(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const page =
    url.protocol === 'https:' &&
    url.hostname.includes('.') &&
    !url.username &&
    !url.password
  return page && url.href.length <= PRIVACY_CONTACT_MAX ? url.href : undefined
}

function emailAddress(value: string) {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL.test(value)
    ? value
    : undefined
}

// What is stored for what the owner typed: null for nothing (no contact), the
// address or the link as it is to be shown, undefined for anything else — a
// link that isn't https, an address that isn't one, more than one line or
// characters a reader can't see
export function normalizePrivacyContact(raw: string) {
  const value = raw.trim()
  if (value === '') return null
  if (!isPlainText(value, PRIVACY_CONTACT_MAX) || /\s/.test(value)) {
    return undefined
  }
  return /^https:/i.test(value) ? httpsLink(value) : emailAddress(value)
}

// Who answers for the boards of a Kita, at the foot of its public pages
export interface KitaResponsibility {
  kitaName: string
  contact?: { href: string; label: string }
}

// The stored value as a link: an address becomes mailto:, a page is shown
// without its scheme
export function privacyContactLink(stored: string) {
  return stored.startsWith('https://')
    ? {
        href: stored,
        label: stored.slice('https://'.length).replace(/\/$/, ''),
      }
    : { href: `mailto:${stored}`, label: stored }
}

// What the form and the action say about a value normalizePrivacyContact
// turns away
export const PRIVACY_CONTACT_INVALID =
  'Bitte geben Sie eine E-Mail-Adresse oder einen Link mit https:// an.'
