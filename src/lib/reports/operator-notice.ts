import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { organization } from '@/db/schema'
import { kitaBoardUrl } from '@/lib/board/secrets'
import { dateAndTime } from '@/lib/board/time'
import type { BoardLink } from '@/lib/board/types'
import { operatorDetails } from '@/lib/instance'
import type { MailDetail } from '@/lib/mail/details'
import { sendMail, type Mail } from '@/lib/mail/mailer'
import {
  operatorReportMail,
  operatorReportReceiptMail,
} from '@/lib/mail/templates'
import { allowAuthMail } from '@/lib/spam/guard'
import { countSpamEvent } from '@/lib/spam/metrics'

import type { ReportedNote } from './mutations'
import { reportReasonLabel, type ReportReason } from './types'

// A report with the option „auch an den Betreiber melden“: a notice of
// illegal content to the provider of the hosting service, which the Kita is
// not (DSA Art. 16). The case goes to the Kita as with any report
// (notes.report); on top of it the operator (OPERATOR_EMAIL) gets a mail with
// everything Art. 16(2) asks for, and the visitor, if they gave an address, a
// confirmation of receipt (Art. 16(4)). The visitor's name and address are in
// that mail only — the database keeps nothing of them. The operator decides, takes the
// note down with scripts/admin.ts (remove-note) and answers the visitor by
// mail (Art. 16(5)).

// How the mails go out. An object, so the tests can read them instead.
export const operatorReportMails: { send: (mail: Mail) => Promise<boolean> } = {
  send: sendMail,
}

// Only an instance that names an operator address offers the option; the
// hosted instance always does (OPERATOR_EMAIL is required there)
export function operatorReportAddress() {
  return operatorDetails.email
}

// Who reported, as far as they said: both may be empty
interface Notifier {
  name: string
  email: string
}

interface OperatorReport {
  link: BoardLink
  board: { name: string; organizationId: string }
  reported: ReportedNote
  reason: ReportReason
  remarks: string
  notifier: Notifier
}

const NOT_GIVEN = 'nicht angegeben'

async function kitaName(organizationId: string) {
  const [found] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return found?.name ?? NOT_GIVEN
}

// What the operator's mail lists, line by line
async function operatorReportDetails(
  { link, board, reported, reason, remarks, notifier }: OperatorReport,
  now: Date,
): Promise<MailDetail[]> {
  return [
    { label: 'Kita', value: await kitaName(board.organizationId) },
    { label: 'Brett', value: board.name },
    {
      label: 'Adresse des Bretts',
      value: kitaBoardUrl(link.kitaToken, link.boardId),
    },
    { label: 'Zettel-ID', value: reported.id },
    { label: 'Grund', value: reportReasonLabel(reason) },
    { label: 'Hinweise', value: remarks || NOT_GIVEN },
    { label: 'Titel', value: reported.title },
    { label: 'Text', value: reported.body },
    { label: 'Name auf dem Zettel', value: reported.author },
    { label: 'Kontakt auf dem Zettel', value: reported.contact || NOT_GIVEN },
    { label: 'Angepinnt am', value: dateAndTime(reported.createdAt) },
    { label: 'Läuft ab am', value: dateAndTime(reported.expiresAt) },
    { label: 'Gemeldet am', value: dateAndTime(now) },
    { label: 'Name der meldenden Person', value: notifier.name || NOT_GIVEN },
    {
      label: 'E-Mail der meldenden Person',
      value: notifier.email || NOT_GIVEN,
    },
    {
      label: 'Erklärung',
      value:
        'Die meldende Person ist überzeugt, dass ihre Angaben richtig und vollständig sind.',
    },
    {
      label: 'Zettel abnehmen',
      value: `node dist/admin.mjs remove-note --id ${reported.id}`,
    },
  ]
}

// Sends the operator's mail once the report is stored, and the confirmation
// after it — only when the operator's mail was handed to the mail server,
// and only within the mail budgets of the address (`report-receipt`, per
// network and in total), so the form can't be used to flood a mailbox.
// Whether each went out: if the operator's mail didn't, the visitor is told
// to write to the operator directly, since nothing of the notice is kept to
// try again with; the form promises a confirmation only if one was sent.
export async function sendOperatorReport(
  report: OperatorReport,
  request: Request,
  now: Date,
): Promise<{ sent: boolean; receiptSent: boolean }> {
  const sent = await operatorReportMails.send({
    to: operatorDetails.email,
    ...operatorReportMail(await operatorReportDetails(report, now)),
  })
  countSpamEvent(sent ? 'report:operator-sent' : 'report:operator-failed')
  const { email } = report.notifier
  const receiptSent =
    sent &&
    !!email &&
    (await allowAuthMail(email, 'report-receipt', request, now)) &&
    (await operatorReportMails.send({
      to: email,
      ...operatorReportReceiptMail(),
    }))
  return { sent, receiptSent }
}
