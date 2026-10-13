import { HOSTED_ORGANIZATION_CAP, kitaLimitMessage } from '@/lib/limits'

import type { KitaCreationRefusal } from './kita-limit'

// What people read when the hosted instance turns something away, and the
// sentences about a subscription that more than one place says. No server
// code in here: the browser shows the same sentences for the same codes.

// A paused Kita, to its admins ("Sie") …
export const HOSTED_PAUSED_ADMIN =
  'Das Abo dieser Kita ist pausiert. Bretter lassen sich erst wieder bearbeiten, wenn es verlängert wurde.'

// … and to the visitors of its boards ("du")
export const HOSTED_PAUSED_VISITOR =
  'Dieses Brett ist gerade pausiert. Bitte sprich die Kita darauf an.'

// Why another Kita can't be created (./kita-limit.ts)
export const KITA_CREATION_MESSAGES: Record<KitaCreationRefusal, string> = {
  HOSTED_TRIAL_ONE_KITA:
    'In der Testphase lässt sich eine Kita anlegen. Weitere Kitas gibt es mit dem Abo.',
  HOSTED_SUBSCRIPTION_INACTIVE:
    'Das Abo ist abgelaufen oder pausiert. Solange lassen sich keine weiteren Kitas anlegen. Wie es weitergeht, steht unter „Abo“.',
  HOSTED_KITA_LIMIT: kitaLimitMessage(HOSTED_ORGANIZATION_CAP),
}

// What the hosted instance asks of an account before its first Kita
// (checkKitaCreation in src/lib/auth.ts), and before an invoice when the
// terms were never agreed to or have changed since
export const TERMS_NOT_ACCEPTED =
  'Bitte stimmen Sie den AGB und dem Vertrag zur Auftragsverarbeitung zu.'
// … and when the form showed a version that is no longer the current one
export const TERMS_VERSION_CHANGED =
  'AGB oder AV-Vertrag haben sich inzwischen geändert. Bitte laden Sie die Seite neu und stimmen Sie der aktuellen Fassung zu.'

// Why an invoice request is turned away besides (src/actions/subscription.ts)
export const BILLING_LOOKS_LIKE_LINK =
  'Rechnungsempfänger, Anschrift und Leitweg-ID / Bestellnummer dürfen keinen Link enthalten.'
export const SUBSCRIPTION_IS_FREE =
  'Dieses Konto ist dauerhaft freigeschaltet und braucht keine Rechnung.'

// Which of the two ran out, as a sentence about it begins
export const ENDED_PERIOD = { trial: 'Die Testphase', subscription: 'Das Abo' }

// What a pause means, and whose business the subscription of a Kita is: said
// by the notice above every admin page and by the subscription page
export const BOARDS_PAUSED =
  'Die Bretter sind für Eltern nicht erreichbar und lassen sich nicht bearbeiten.'
// That the data can still be taken along while the Kita waits for its
// deletion (/admin/kita/export), said wherever the pause is
export const EXPORT_UNTIL_DELETION =
  'Bis zur Löschung lassen sich die Daten unter „Kita-Einstellungen“ exportieren.'
export const OWNER_TAKES_CARE =
  'Um das Abo kümmert sich die Inhaberin oder der Inhaber der Kita.'
