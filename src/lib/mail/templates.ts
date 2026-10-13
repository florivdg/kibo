import type { EndedPeriod } from '@/lib/hosted/state'
import { INVITATION_TTL_DAYS } from '@/lib/limits'
import { detailText, type MailDetail } from '@/lib/mail/details'
import {
  invitationNotice,
  mailFooter,
  type MailFooter,
  type MailNotice,
} from '@/lib/mail/footer'
import type { Mail } from '@/lib/mail/mailer'

// The button and where it leads
interface MailLink {
  action: string
  url: string
  // How long the link works, for a link that carries a token. One to a page
  // has nothing to say here.
  validity?: string
}

interface MailContent {
  subject: string
  intro: string
  details?: MailDetail[]
  // A mail that only reports something has none
  link?: MailLink
  // Above the signature, smaller: what an invitation says about the address
  notice?: MailNotice
}

// Every link Better Auth mails out on its own is valid for its default hour
function tokenLink(action: string, url: string): MailLink {
  return { action, url, validity: 'Der Link ist eine Stunde gültig.' }
}

// An invitation waits for someone who didn't ask for it
const INVITATION_VALIDITY = `Der Link ist ${INVITATION_TTL_DAYS} Tage gültig.`

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => HTML_ENTITIES[char] ?? char)
}

// Escaped first, so the only markup in it is the line breaks
function escapeLines(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

function detailValueHtml({ value, link }: MailDetail) {
  return link
    ? `<a href="${escapeHtml(value)}" style="color:#18181b;word-break:break-all">${escapeHtml(value)}</a>`
    : escapeLines(value)
}

function detailsHtml(details: MailDetail[]) {
  const rows = details
    .map(
      (detail) => `
        <tr>
          <td style="padding:0 16px 8px 0;vertical-align:top;color:#52525b">${escapeHtml(detail.label)}</td>
          <td style="padding:0 0 8px;vertical-align:top">${detailValueHtml(detail)}</td>
        </tr>`,
    )
    .join('')
  return `
      <table role="presentation" style="margin:0 0 16px;border-collapse:collapse;font-size:14px">${rows}
      </table>`
}

// The button, and under it the address for a client that shows none
function linkHtml({ action, url, validity }: MailLink) {
  const hint = `Falls der Button nicht funktioniert, öffnen Sie diese Adresse im Browser:`
  return `
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#18181b;border-radius:8px;color:#ffffff;text-decoration:none">${escapeHtml(action)}</a>
      </p>
      <p style="margin:0 0 24px;font-size:14px;color:#52525b">
        ${escapeHtml(validity ? `${validity} ${hint}` : hint)}<br />
        <a href="${escapeHtml(url)}" style="color:#52525b">${escapeHtml(url)}</a>
      </p>`
}

function noticeText({ title, text, link }: MailNotice) {
  return `${title}: ${text} ${link.label}:\n${link.url}`
}

function noticeHtml({ title, text, link }: MailNotice) {
  return `
      <p style="margin:0 0 24px;font-size:13px;color:#52525b">
        <strong>${escapeHtml(title)}</strong><br />
        ${escapeHtml(text)} ${escapeHtml(link.label)}:
        <a href="${escapeHtml(link.url)}" style="color:#52525b">${escapeHtml(link.url)}</a>
      </p>`
}

// Under the signature, set apart by the usual "-- " line: who runs the
// instance, what their legal form has them name, imprint and privacy policy
function footerText({ operator, legalInfo, links }: MailFooter) {
  const blocks = [
    operator,
    legalInfo,
    links.map(({ label, url }) => `${label}: ${url}`),
  ]
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\n'))
  return `-- \n${blocks.join('\n\n')}`
}

// The same below the card, in small print. Every line is configurable text,
// so every line is escaped.
function footerHtml({ operator, legalInfo, links }: MailFooter) {
  const lines = (values: string[]) => values.map(escapeHtml).join('<br />')
  const paragraphs = [operator, legalInfo]
    .filter((values) => values.length > 0)
    .map((values) => `\n      <p style="margin:0 0 8px">${lines(values)}</p>`)
    .join('')
  const anchors = links
    .map(
      ({ label, url }) =>
        `<a href="${escapeHtml(url)}" style="color:#71717a">${escapeHtml(label)}</a>`,
    )
    .join(' · ')
  return `
    <div style="max-width:32rem;margin:16px auto 0;padding:0 32px;font-size:12px;line-height:1.5;color:#71717a">${paragraphs}
      <p style="margin:0">${anchors}</p>
    </div>`
}

// One plain layout for every mail Kibo sends. Mail clients ignore stylesheets,
// so the few styles there are have to be inline.
// The plain-text version has no button: the address stands where the button
// would be, under the action it performs.
// `name` greets the recipient; an invitation goes to an address Kibo knows no
// name for, and is greeted without one.
// Every mail ends with the same footer (src/lib/mail/footer.ts), in both
// versions: a new mail that goes through here has it without asking.
function render(
  name: string | undefined,
  content: MailContent,
): Omit<Mail, 'to'> {
  const { subject, intro, details = [], link, notice } = content
  const greeting = name ? `Hallo ${name},` : 'Hallo,'
  const footer = mailFooter()
  const text = [
    greeting,
    intro,
    details.map(detailText).join('\n'),
    link && `${link.action}:\n${link.url}`,
    link?.validity,
    notice && noticeText(notice),
    'Viele Grüße\nIhr Kibo-Team',
    footerText(footer),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    subject,
    text,
    html: `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,sans-serif;color:#18181b">
    <div style="max-width:32rem;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px">
      <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 24px">${escapeHtml(intro)}</p>${details.length ? detailsHtml(details) : ''}${link ? linkHtml(link) : ''}${notice ? noticeHtml(notice) : ''}
      <p style="margin:0;font-size:14px;color:#52525b">Viele Grüße<br />Ihr Kibo-Team</p>
    </div>${footerHtml(footer)}
  </body>
</html>`,
  }
}

export function verificationMail(name: string, url: string) {
  return render(name, {
    subject: 'Bestätigen Sie Ihre E-Mail-Adresse für Kibo',
    intro:
      'willkommen bei Kibo! Bestätigen Sie bitte Ihre E-Mail-Adresse, um sich anmelden zu können.',
    link: tokenLink('E-Mail-Adresse bestätigen', url),
  })
}

export function passwordResetMail(name: string, url: string) {
  return render(name, {
    subject: 'Passwort für Kibo zurücksetzen',
    intro:
      'Sie haben ein neues Passwort für Ihr Kibo-Konto angefordert. Über den folgenden Link vergeben Sie es. Wenn Sie das nicht waren, können Sie diese E-Mail ignorieren.',
    link: tokenLink('Neues Passwort vergeben', url),
  })
}

// First step of an address change, sent to the current address: nothing
// changes until its owner agrees
export function emailChangeConfirmationMail(
  name: string,
  newEmail: string,
  url: string,
) {
  return render(name, {
    subject: 'Neue E-Mail-Adresse für Kibo bestätigen',
    intro: `für Ihr Kibo-Konto wurde die neue E-Mail-Adresse ${newEmail} eingetragen. Stimmen Sie der Änderung über den folgenden Link zu; danach schicken wir einen zweiten Link an die neue Adresse. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail und ändern Sie Ihr Passwort.`,
    link: tokenLink('Änderung zustimmen', url),
  })
}

// Second step, sent to the new address: opening it switches the account over
export function newEmailVerificationMail(name: string, url: string) {
  return render(name, {
    subject: 'Bestätigen Sie Ihre neue E-Mail-Adresse für Kibo',
    intro:
      'bestätigen Sie bitte, dass diese Adresse künftig zu Ihrem Kibo-Konto gehört. Öffnen Sie den Link in dem Browser, in dem Sie bei Kibo angemeldet sind.',
    link: tokenLink('Neue Adresse bestätigen', url),
  })
}

// Sent to an address the owner of a Kita typed in, which may belong to anyone:
// the mail says who invites and to what, and that it can be ignored. The link
// leads to the invitation page (INVITATION_PATH) and signs nobody in.
export function invitationMail({
  organizationName,
  inviterName,
  url,
}: {
  organizationName: string
  inviterName: string
  url: string
}) {
  return render(undefined, {
    subject: `Einladung zur Kita „${organizationName}“ bei Kibo`,
    intro: `${inviterName} hat Sie eingeladen, die Kita „${organizationName}“ bei Kibo mitzuverwalten. Über den folgenden Link nehmen Sie die Einladung an; falls Sie noch kein Konto haben, legen Sie dabei eines an. Kennen Sie ${inviterName} nicht, ignorieren Sie diese E-Mail.`,
    link: { action: 'Einladung ansehen', url, validity: INVITATION_VALIDITY },
    notice: invitationNotice(organizationName),
  })
}

// To every owner and admin of a Kita, each on their own, when a visitor
// reported a note (src/lib/reports/outbox.ts) — or several, collected while
// the last mail was recent enough. Only that something was reported and
// where to look: no note text, nothing the visitor wrote, no board link. The
// link leads to a page that needs the normal sign-in, so nothing about it
// expires.
export function noteReportMail(
  name: string,
  {
    organizationName,
    count,
    url,
  }: { organizationName: string; count: number; url: string },
) {
  const intro =
    count === 1
      ? `auf einem Brett der Kita „${organizationName}“ wurde ein Zettel gemeldet. Bitte prüfen Sie im Admin-Bereich, ob der Zettel hängen bleiben kann. Der Zettel bleibt sichtbar, bis jemand aus Ihrem Team entscheidet.`
      : `auf den Brettern der Kita „${organizationName}“ wurden ${count} Zettel gemeldet. Bitte prüfen Sie im Admin-Bereich, ob die Zettel hängen bleiben können. Die Zettel bleiben sichtbar, bis jemand aus Ihrem Team entscheidet.`
  return render(name, {
    subject: 'Kibo: Neuer gemeldeter Zettel',
    intro,
    link: {
      action: count === 1 ? 'Meldung ansehen' : 'Meldungen ansehen',
      url,
    },
  })
}

// The two mails of a report that also goes to the operator, a notice of
// illegal content (DSA Art. 16; src/lib/reports/operator-notice.ts).

// To the operator (OPERATOR_EMAIL): where the note hangs, the copy of it the
// server read, what the visitor said, who they are if they said, and the
// call that takes the note down. Everything but the labels was typed by
// somebody, so it stands among the details, which render() escapes, and the
// subject is fixed. No button: the board's address is text like the rest.
export function operatorReportMail(details: MailDetail[]) {
  return render(undefined, {
    subject: 'Kibo: Hinweis auf rechtswidrigen Inhalt',
    intro:
      'über das Melden-Formular eines Bretts ist ein Hinweis auf einen rechtswidrigen Inhalt eingegangen (Art. 16 DSA). Die Kita hat die Meldung ebenfalls bekommen. Bitte prüfen Sie den Zettel zeitnah, sorgfältig und objektiv; der Befehl unten nimmt ihn ab. Hat die meldende Person eine E-Mail-Adresse angegeben, teilen Sie ihr Ihre Entscheidung mit.',
    details,
  })
}

// To the address the visitor typed, which may be anybody's: a fixed text,
// nothing the visitor or the note's author wrote — no name, no remarks, no
// note — and no link, so the form can't be used to send a stranger a
// message.
export function operatorReportReceiptMail() {
  return render(undefined, {
    subject: 'Kibo: Ihre Meldung ist eingegangen',
    intro:
      'wir haben Ihre Meldung eines Zettels auf einem Kibo-Brett erhalten und prüfen sie. Über unsere Entscheidung informieren wir Sie an diese Adresse. Haben Sie nichts gemeldet, können Sie diese E-Mail ignorieren.',
  })
}

// The mails of the hosted instance (src/lib/hosted/): the reminders the
// hourly run sends to the owner of an account — a week before its trial or
// its paid year ends, at the end, when the Kitas are paused and before they
// are deleted — and the two that follow an invoice request. The dates come
// written out; the reminders link to the subscription page, which is a page
// and not a token, so nothing about the link expires.

function reminder(
  name: string,
  { url, ...content }: { subject: string; intro: string; url: string },
) {
  return render(name, { ...content, link: { action: 'Zum Abo', url } })
}

// In the two mails that come once the boards are paused: the data can still
// be taken along (/admin/kita/export)
const EXPORT_BEFORE_DELETION =
  'Bis zur Löschung können Sie die Daten Ihrer Kitas unter „Kita-Einstellungen“ exportieren.'

const HOW_TO_CONTINUE =
  'Auf der Abo-Seite fordern Sie eine Rechnung an; nach Zahlungseingang schalten wir das Abo frei. Es verlängert sich nicht automatisch.'

// A week before the trial or a paid year ends. `lastDay` is the last day
// that is covered.
export function subscriptionEndingMail(
  name: string,
  { ended, lastDay, url }: { ended: EndedPeriod; lastDay: string; url: string },
) {
  const trial = ended === 'trial'
  const ends = trial
    ? `die Testphase Ihres Kibo-Kontos endet am ${lastDay}`
    : `das Abo Ihres Kibo-Kontos läuft am ${lastDay} ab`
  const needs = trial ? 'ein Abo' : 'ein Abo für das nächste Jahr'
  return reminder(name, {
    subject: trial
      ? 'Ihre Kibo-Testphase endet bald'
      : 'Ihr Kibo-Abo läuft bald ab',
    intro: `${ends}. Damit Ihre Bretter danach erreichbar bleiben, braucht das Konto ${needs}. ${HOW_TO_CONTINUE}`,
    url,
  })
}

// At the end: the grace period begins. `pausesOn` is the day the boards close.
export function subscriptionExpiredMail(
  name: string,
  {
    ended,
    lastDay,
    pausesOn,
    url,
  }: { ended: EndedPeriod; lastDay: string; pausesOn: string; url: string },
) {
  const what = ended === 'trial' ? 'die Testphase' : 'das Abo'
  return reminder(name, {
    subject:
      ended === 'trial'
        ? 'Ihre Kibo-Testphase ist abgelaufen'
        : 'Ihr Kibo-Abo ist abgelaufen',
    intro: `${what} Ihres Kibo-Kontos ist am ${lastDay} abgelaufen. Vorerst funktioniert alles weiter. Ab dem ${pausesOn} werden die Bretter Ihrer Kitas pausiert: Eltern können sie dann nicht mehr öffnen. ${HOW_TO_CONTINUE}`,
    url,
  })
}

// The boards are closed. `deletableOn` is the day the Kitas are due to go.
export function subscriptionPausedMail(
  name: string,
  { deletableOn, url }: { deletableOn: string; url: string },
) {
  return reminder(name, {
    subject: 'Ihre Kibo-Bretter sind pausiert',
    intro: `die Bretter Ihrer Kitas sind jetzt pausiert: Eltern können sie nicht mehr öffnen, und sie lassen sich nicht bearbeiten. Bretter, Zettel und Einstellungen bleiben vorerst erhalten. Ohne Abo werden Ihre Kitas frühestens am ${deletableOn} gelöscht; vorher schreiben wir Ihnen noch einmal. ${EXPORT_BEFORE_DELETION} ${HOW_TO_CONTINUE}`,
    url,
  })
}

// Two weeks before the Kitas are deleted; nothing is deleted without it
export function deletionNoticeMail(
  name: string,
  { deletesOn, url }: { deletesOn: string; url: string },
) {
  return reminder(name, {
    subject: 'Ihre Kitas bei Kibo werden gelöscht',
    intro: `für Ihr Kibo-Konto besteht seit Längerem kein Abo. Ohne Abo löschen wir am ${deletesOn} Ihre Kitas mit allen Brettern, Zetteln, Benachrichtigungen und Mitgliedschaften. Das lässt sich nicht rückgängig machen. Ihr Konto bleibt bestehen. ${EXPORT_BEFORE_DELETION} ${HOW_TO_CONTINUE}`,
    url,
  })
}

// The two mails that follow an invoice request (src/lib/hosted/invoice.ts).
// What they list is put together in one place, for them and for the
// operator's script (invoiceFacts in src/lib/hosted/billing.ts).

// To the operator (HOSTED_OPERATOR_EMAIL): everything the invoice needs, and
// the line that says it was paid. No link — what the account typed is text.
export function invoiceRequestOperatorMail(
  accountEmail: string,
  details: MailDetail[],
) {
  return render(undefined, {
    subject: `Rechnungsanfrage von ${accountEmail}`,
    intro:
      'ein Konto hat eine Rechnung für das Jahresabo angefordert. Nach Zahlungseingang schaltet der Befehl unten das Abo frei.',
    details,
  })
}

// To the address the invoice goes to, which the account typed and which may
// be somebody else's: what was asked for and what happens next, nothing about
// the account, and no link.
export function invoiceRequestConfirmationMail(details: MailDetail[]) {
  return render(undefined, {
    subject: 'Ihre Rechnungsanfrage für Kibo',
    intro:
      'für Kibo wurde eine Rechnung über das Jahresabo an diese Adresse angefordert. Die Rechnung kommt per E-Mail; nach Zahlungseingang wird das Abo freigeschaltet. Es verlängert sich nicht automatisch. Haben Sie nichts angefordert, können Sie diese E-Mail ignorieren.',
    details,
  })
}

// To the account, once it has agreed to the terms and the data processing
// agreement of the hosted instance (src/lib/hosted/terms.ts): a record it
// can keep of who agreed to which version, when, and where both texts can
// be read in exactly that version.
export function termsConfirmationMail(name: string, details: MailDetail[]) {
  return render(name, {
    subject: 'Ihre Zustimmung zu den AGB und zum AV-Vertrag von Kibo',
    intro:
      'Sie haben den Allgemeinen Geschäftsbedingungen und dem Vertrag zur Auftragsverarbeitung von Kibo zugestimmt. Diese E-Mail hält fest, wer welcher Fassung wann zugestimmt hat; bitte bewahren Sie sie auf. Beide Texte bleiben in genau dieser Fassung unter den Adressen unten abrufbar.',
    details,
  })
}
