import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { ActionAPIContext } from 'astro:actions'

import { notes } from '@/actions/notes'
import type { BoardLink } from '@/lib/board/types'
import { operatorDetails } from '@/lib/instance'
import type { Mail } from '@/lib/mail/mailer'
import { operatorReportMails } from '@/lib/reports/operator-notice'
import type { ReportReason } from '@/lib/reports/types'
import { MAIL_BUDGETS, REPORT_OPERATOR_BUDGETS } from '@/lib/spam/budgets'

import { refusal, visitorContext } from './helpers/actions'
import {
  insertTestNote,
  newOwnedKita,
  newTestBoard,
  removeTestKitas,
  removeTestUsers,
} from './helpers/fixtures'
import { casesOf, reportsOf } from './helpers/reports'
import { resetSpamCounters } from './helpers/spam-db'

// A report that also goes to the operator: a notice of illegal content
// (notes.report with `operator`, src/lib/reports/operator-notice.ts). The
// mails are caught instead of sent; every test works on a Kita of its own.

const OPERATOR = 'betrieb@kibo.example'
const kitas: string[] = []
const users: string[] = []
const realSend = operatorReportMails.send
let sent: Mail[] = []
let delivers = true

// A network per report, so the per-network budgets stay out of the way
let visitors = 0
function nextVisitor() {
  visitors += 1
  return visitorContext(`192.0.2.${visitors % 250}`)
}

async function newKita() {
  const { organizationId, owner } = await newOwnedKita()
  kitas.push(organizationId)
  users.push(owner.id)
  const target = await newTestBoard(organizationId, { name: 'Igelgruppe' })
  const noteId = await insertTestNote(target.id, {
    title: 'Ganz schlimmer Zettel',
    body: 'Rechtswidriger Text',
    author: 'Mallory',
    contact: 'mallory@example.org',
  })
  return { organizationId, board: target, noteId }
}

interface OperatorInput {
  name?: string
  email?: string
  goodFaith?: boolean
}

function report(
  link: BoardLink,
  noteId: string,
  {
    reason = 'offensive',
    remarks = '',
    operator,
    context = nextVisitor(),
  }: {
    reason?: ReportReason
    remarks?: string
    operator?: OperatorInput
    context?: ActionAPIContext
  } = {},
) {
  return notes.report.orThrow.call(context, {
    ...link,
    noteId,
    reason,
    remarks,
    website: '',
    operator: operator && {
      name: '',
      email: '',
      goodFaith: true,
      ...operator,
    },
  } as Parameters<typeof notes.report.orThrow>[0])
}

function mailsTo(address: string) {
  return sent.filter(({ to }) => to === address)
}

beforeEach(async () => {
  await resetSpamCounters()
  sent = []
  delivers = true
  operatorDetails.email = OPERATOR
  operatorReportMails.send = async (mail) => {
    sent.push(mail)
    return delivers
  }
})

afterEach(() => {
  operatorDetails.email = ''
  operatorReportMails.send = realSend
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('notes.report to the operator', () => {
  test('without the option, nothing goes to the operator', async () => {
    const kita = await newKita()
    expect(await report(kita.board.link, kita.noteId)).toBeUndefined()
    expect(sent).toEqual([])
    expect(await casesOf(kita.organizationId)).toHaveLength(1)
  })

  test('mails the operator everything the notice needs, and files the case for the Kita as usual', async () => {
    const kita = await newKita()
    const answer = await report(kita.board.link, kita.noteId, {
      remarks: 'Volksverhetzung, siehe Text',
      operator: { name: 'Erika Muster' },
    })
    // No address, no confirmation
    expect(answer).toEqual({ operatorNotified: true, receiptSent: false })

    const [mail, ...more] = sent
    expect(more).toEqual([])
    expect(mail!.to).toBe(OPERATOR)
    expect(mail!.subject).toBe('Kibo: Hinweis auf rechtswidrigen Inhalt')
    for (const fact of [
      'Kita: Test-Kita',
      'Brett: Igelgruppe',
      `/k/${kita.board.kitaToken}/${kita.board.id}/`,
      `Zettel-ID: ${kita.noteId}`,
      'Grund: Beleidigung oder unangemessener Inhalt',
      'Hinweise: Volksverhetzung, siehe Text',
      'Titel: Ganz schlimmer Zettel',
      'Text: Rechtswidriger Text',
      'Name auf dem Zettel: Mallory',
      'Kontakt auf dem Zettel: mallory@example.org',
      'Name der meldenden Person: Erika Muster',
      'E-Mail der meldenden Person: nicht angegeben',
      'richtig und vollständig',
      `node dist/admin.mjs remove-note --id ${kita.noteId}`,
    ]) {
      expect(mail!.text).toContain(fact)
    }

    // The Kita gets its case all the same, without the notifier in it
    const [found] = await casesOf(kita.organizationId)
    expect(found).toMatchObject({ noteId: kita.noteId, status: 'open' })
    const kept = await reportsOf(found!.id)
    expect(kept.map(({ remarks }) => remarks)).toEqual([
      'Volksverhetzung, siehe Text',
    ])
    expect(JSON.stringify({ found, kept })).not.toContain('Erika')
  })

  test('confirms receipt to the notifier without repeating anything they or the note said', async () => {
    const kita = await newKita()
    expect(
      await report(kita.board.link, kita.noteId, {
        remarks: 'Kauf jetzt bei https://spam.example',
        operator: { name: 'Erika Muster', email: ' Erika@Example.org ' },
      }),
    ).toEqual({ operatorNotified: true, receiptSent: true })
    expect(mailsTo(OPERATOR)[0]!.text).toContain(
      'E-Mail der meldenden Person: Erika@Example.org',
    )
    const [receipt, ...more] = mailsTo('Erika@Example.org')
    expect(more).toEqual([])
    expect(receipt!.subject).toBe('Kibo: Ihre Meldung ist eingegangen')
    for (const echoed of [
      'Erika',
      'spam.example',
      'Ganz schlimmer',
      'Rechtswidriger Text',
      'Mallory',
      kita.noteId,
      kita.board.kitaToken,
    ]) {
      expect(receipt!.text).not.toContain(echoed)
      expect(receipt!.html).not.toContain(echoed)
    }
  })

  test('no receipt when the operator mail did not go out, and the answer says so', async () => {
    const kita = await newKita()
    delivers = false
    expect(
      await report(kita.board.link, kita.noteId, {
        operator: { email: 'erika@example.org' },
      }),
    ).toEqual({ operatorNotified: false, receiptSent: false })
    expect(sent.map(({ to }) => to)).toEqual([OPERATOR])
    // The Kita has the report regardless
    expect(await casesOf(kita.organizationId)).toHaveLength(1)
  })

  test('receipts count against the mail budgets of the address', async () => {
    const kita = await newKita()
    const context = visitorContext('192.0.2.251')
    const max = MAIL_BUDGETS['report-receipt'].recipientClient[0]!.max
    for (let i = 0; i <= max; i++) {
      const noteId = await insertTestNote(kita.board.id, { title: `Z${i}` })
      // The form promises a confirmation only while one goes out
      expect(
        await report(kita.board.link, noteId, {
          context,
          operator: { email: 'erika@example.org' },
        }),
      ).toEqual({ operatorNotified: true, receiptSent: i < max })
    }
    // Every notice reached the operator, but only so many receipts went out
    expect(mailsTo(OPERATOR)).toHaveLength(max + 1)
    expect(mailsTo('erika@example.org')).toHaveLength(max)
  })

  test('a note reaches the operator only so often a day; it can still go to the Kita', async () => {
    const kita = await newKita()
    const max = REPORT_OPERATOR_BUDGETS.find(
      ({ subject }) => subject === 'note',
    )!.max
    for (let i = 0; i < max; i++) {
      await report(kita.board.link, kita.noteId, { operator: {} })
    }
    const refused = await refusal(
      report(kita.board.link, kita.noteId, { operator: {} }),
    )
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
    expect(refused!.message).toContain('ohne diese Option')
    expect(refused!.message).toContain(operatorDetails.email)
    expect(mailsTo(OPERATOR)).toHaveLength(max)
    // Refused as a whole: the case counts only what went through
    const [found] = await casesOf(kita.organizationId)
    expect(found!.reportCount).toBe(max)

    expect(await report(kita.board.link, kita.noteId)).toBeUndefined()
    expect((await casesOf(kita.organizationId))[0]!.reportCount).toBe(max + 1)
    expect(mailsTo(OPERATOR)).toHaveLength(max)
  })

  test('a note that is gone spends none of the operator budget', async () => {
    const kita = await newKita()
    const max = REPORT_OPERATOR_BUDGETS.find(
      ({ subject }) => subject === 'note',
    )!.max
    const other = await newTestBoard(kita.organizationId)
    // Another board's note through this board's link: 404, nothing counted
    for (let i = 0; i < max + 1; i++) {
      expect(
        await refusal(report(other.link, kita.noteId, { operator: {} })),
      ).toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(
      await report(kita.board.link, kita.noteId, { operator: {} }),
    ).toEqual({ operatorNotified: true, receiptSent: false })
  })

  test('refuses the option without the statement, with a bad address, or without an operator address', async () => {
    const kita = await newKita()
    // The schema throws before the handler runs
    const invalid = async (operator: OperatorInput) => {
      try {
        await report(kita.board.link, kita.noteId, { operator })
        return false
      } catch {
        return true
      }
    }
    expect(await invalid({ goodFaith: false })).toBe(true)
    expect(await invalid({ email: 'keine-adresse' })).toBe(true)
    expect(await invalid({ name: 'Erika\u0007' })).toBe(true)
    // An instance without an operator address offers nobody to tell
    operatorDetails.email = ''
    expect(
      await refusal(report(kita.board.link, kita.noteId, { operator: {} })),
    ).toMatchObject({ code: 'BAD_REQUEST' })
    expect(sent).toEqual([])
    expect(await casesOf(kita.organizationId)).toEqual([])
  })
})
