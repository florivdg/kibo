import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import { and, eq, inArray } from 'drizzle-orm'

import { assertFound } from '@/actions/assert-found'
import { assertBoardOpen } from '@/actions/kita-access'
import { noteCursor } from '@/actions/note-cursor'
import { optionalText, requiredText } from '@/actions/text-fields'
import {
  boardLink,
  pushEndpoint,
  visitorClient,
  visitorNetworks,
} from '@/actions/visitor'
import { db } from '@/db'
import { board, note } from '@/db/schema'
import { hasCategory } from '@/lib/board/board-types'
import {
  boardBudgetKey,
  kitaBudgetKey,
  linkedBoardIds,
} from '@/lib/board/kita-link'
import {
  findLinkedBoard,
  notePage,
  publicNoteColumns,
  toNote,
} from '@/lib/board/queries'
import { hashDeleteKey, isLinkToken, newDeleteKey } from '@/lib/board/secrets'
import { addDays } from '@/lib/board/time'
import {
  NOTE_AUTHOR_MAX,
  NOTE_BODY_MAX,
  NOTE_CONTACT_MAX,
  NOTE_DURATIONS,
  NOTE_TITLE_MAX,
  type BoardLink,
} from '@/lib/board/types'
import { EMAIL_MAX_LENGTH } from '@/lib/limits'
import { pushDispatcher } from '@/lib/push/dispatcher'
import { fileReport, reportedNote } from '@/lib/reports/mutations'
import {
  operatorReportAddress,
  sendOperatorReport,
} from '@/lib/reports/operator-notice'
import { reportMailer } from '@/lib/reports/outbox'
import {
  REPORT_NOTIFIER_NAME_MAX,
  REPORT_REASON_IDS,
  REPORT_REMARKS_MAX,
  type OperatorReportOutcome,
} from '@/lib/reports/types'
import {
  allowBoardPost,
  allowBoardReport,
  allowClientBoardPost,
  allowClientBoardReport,
  allowClientNoteReport,
  allowNoteFormToken,
  allowNoteFormTokenIssue,
  allowNoteList,
  allowNotePost,
  allowNoteRemoval,
  allowOperatorReport,
  allowReport,
  claimNoteContent,
  type LimitVerdict,
} from '@/lib/spam/guard'
import { countSpamEvent, type SpamEvent } from '@/lib/spam/metrics'

// The board behind the link; one of another Kita is as unknown as one that
// doesn't exist. One of a Kita the hosted instance has paused takes nothing
// and shows nothing: its page doesn't either (src/pages/k/[kita]/[board].astro).
async function boardOf(link: BoardLink, now: Date) {
  const found = await findLinkedBoard(link, now)
  if (!found) throw new ActionError({ code: 'NOT_FOUND' })
  assertBoardOpen(found)
  return found
}

// The honeypot is checked here rather than in the schema: a schema error would
// name the field (a length limit included), this looks like any invalid input
// to bots. Any length is fine, the action's body size limit bounds it.
function assertEmptyHoneypot(
  website: string,
  event: SpamEvent = 'note:honeypot',
) {
  if (website === '') return
  countSpamEvent(event)
  throw new ActionError({ code: 'BAD_REQUEST' })
}

// A note has to bring the form token its board's composer was handed
// (src/lib/spam/form-token.ts). Refused like the honeypot: any invalid input
// looks the same, and nothing says the token was the matter.
async function assertFormToken(token: string, boardId: string, now: Date) {
  const { allowed, message } = await allowNoteFormToken(token, boardId, now)
  if (allowed) return
  // Only a storage that can't be asked words a refusal
  if (message) throw new ActionError({ code: 'TOO_MANY_REQUESTS', message })
  throw new ActionError({ code: 'BAD_REQUEST' })
}

// Reading a board — a page of it, or a form token for its composer
async function assertMayRead(context: ActionAPIContext) {
  if (await allowNoteList(visitorClient(context))) return
  throw new ActionError({
    code: 'TOO_MANY_REQUESTS',
    message:
      'Das Brett wurde gerade sehr oft geladen. Bitte versuch es gleich nochmal.',
  })
}

// The message travels to the browser, which shows it above the untouched form
function assertAllowed(
  { allowed, message }: LimitVerdict,
  code: 'TOO_MANY_REQUESTS' | 'CONFLICT',
) {
  if (!allowed) throw new ActionError({ code, message })
}

// Public: anyone with the Kita link may post, take down their own notes and
// report the ones that should not hang there
export const notes = {
  create: defineAction({
    input: z.object({
      ...boardLink,
      categoryId: z.string().max(40),
      title: requiredText(NOTE_TITLE_MAX),
      body: requiredText(NOTE_BODY_MAX, { multiline: true }),
      author: requiredText(NOTE_AUTHOR_MAX),
      contact: optionalText(NOTE_CONTACT_MAX),
      durationDays: z.literal(NOTE_DURATIONS),
      website: z.string(),
      // From notes.formToken. Checked in the handler like the honeypot, a
      // missing one included, so no schema error names it
      formToken: z.string().default(''),
      // The poster's own push subscription, if this browser has one: they
      // aren't notified about their own note
      ownEndpoint: pushEndpoint.optional(),
    }),
    handler: async (
      {
        kitaToken,
        boardId,
        durationDays,
        contact,
        website,
        formToken,
        ownEndpoint,
        ...input
      },
      context: ActionAPIContext,
    ) => {
      assertEmptyHoneypot(website)
      const now = new Date()
      // Like the honeypot, before anything is counted: a request without a
      // token from this board's composer costs no budget and no lookup
      await assertFormToken(formToken, boardId, now)
      const networks = visitorNetworks(context)
      const { client } = networks
      // What this one network may do is settled first and on its own — before
      // the board is even looked up — so a noisy client cannot spend the
      // budget everyone else shares, and knocking with made-up links costs it
      // as much as posting.
      assertAllowed(await allowNotePost(networks, now), 'TOO_MANY_REQUESTS')

      const link = { kitaToken, boardId }
      const target = await boardOf(link, now)
      if (!hasCategory(target.type, input.categoryId)) {
        throw new ActionError({ code: 'BAD_REQUEST' })
      }
      const budgetKey = boardBudgetKey(link)
      assertAllowed(
        await allowClientBoardPost(client, budgetKey, now),
        'TOO_MANY_REQUESTS',
      )

      const deleteKey = newDeleteKey()
      // The budgets of the board and its Kita, the note and the claim on its
      // text belong together: an ActionError thrown in here rolls all of them
      // back, so a duplicate costs the board nothing and leaves no text
      // blocked behind.
      const result = await db.transaction(async (tx) => {
        assertAllowed(
          await allowBoardPost(
            { board: budgetKey, kita: kitaBudgetKey(kitaToken) },
            now,
            tx,
          ),
          'TOO_MANY_REQUESTS',
        )
        const [created] = await tx
          .insert(note)
          .values({
            boardId: target.id,
            categoryId: input.categoryId,
            title: input.title,
            body: input.body,
            author: input.author,
            contact: contact || null,
            deleteKeyHash: hashDeleteKey(deleteKey),
            createdAt: now,
            expiresAt: addDays(now, durationDays),
          })
          .returning(publicNoteColumns)
        if (!created) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR' })
        assertAllowed(
          await claimNoteContent(
            target.id,
            [input.title, input.body],
            created.id,
            now,
            tx,
          ),
          'CONFLICT',
        )
        return { note: toNote(created), deleteKey }
      })
      // Only once the note is committed, and without waiting: the
      // notification goes out minutes later, bundled with any that follow
      pushDispatcher.schedule(target.id, result.note.id, ownEndpoint)
      return result
    },
  }),

  // The form token a note on this board is pinned with, fetched by the
  // composer when it opens. Costs what paging costs, and nothing is stored.
  formToken: defineAction({
    input: z.object(boardLink),
    handler: async (link, context: ActionAPIContext) => {
      await assertMayRead(context)
      const now = new Date()
      const target = await boardOf(link, now)
      const { token, message } = await allowNoteFormTokenIssue(target.id, now)
      // Only a storage that can't be asked refuses here
      if (token === undefined) {
        throw new ActionError({ code: 'TOO_MANY_REQUESTS', message })
      }
      return { token }
    },
  }),

  // Older notes of a board, one page at a time
  list: defineAction({
    input: z.object({ ...boardLink, cursor: noteCursor }),
    handler: async ({ cursor, ...link }, context: ActionAPIContext) => {
      await assertMayRead(context)
      const now = new Date()
      const target = await boardOf(link, now)
      return notePage(target.id, now, cursor)
    },
  }),

  // Anyone with the link may report a note they see, without an account. The
  // server reads what is reported itself — the note has to hang on the board
  // behind this link right now — and keeps a copy for the Kita, so an old
  // link, an expired note or a note of another board report nothing. The
  // answer is the same for a new case and one more report of an open one,
  // and carries nothing back; the mails to the Kita's admins go out after
  // the commit, and a mail server that is down doesn't fail the report
  // (src/lib/reports/outbox.ts).
  //
  // With `operator` the report is also a notice of illegal content to the
  // operator (src/lib/reports/operator-notice.ts), offered only where an
  // operator address is set: the case goes to the Kita all the same, the
  // operator's mail goes out after the commit, and the answer says whether
  // it did and whether a confirmation went to the address given. Name and
  // address of whoever reports are in that mail only.
  report: defineAction({
    input: z.object({
      ...boardLink,
      noteId: z.string().max(64),
      reason: z.enum(REPORT_REASON_IDS),
      remarks: optionalText(REPORT_REMARKS_MAX, { multiline: true }),
      website: z.string(),
      operator: z
        .object({
          name: optionalText(REPORT_NOTIFIER_NAME_MAX),
          email: z
            .string()
            .trim()
            .max(EMAIL_MAX_LENGTH)
            .pipe(z.union([z.literal(''), z.email()])),
          // The statement of good faith (DSA Art. 16(2)(d)) isn't optional
          goodFaith: z.literal(true),
        })
        .optional(),
    }),
    handler: async (
      { kitaToken, boardId, noteId, reason, remarks, website, operator },
      context: ActionAPIContext,
    ) => {
      assertEmptyHoneypot(website, 'report:honeypot')
      // Nobody to tell on an instance without an operator address
      if (operator && !operatorReportAddress()) {
        throw new ActionError({ code: 'BAD_REQUEST' })
      }
      const now = new Date()
      const networks = visitorNetworks(context)
      const { client } = networks
      // As with posting: the network on its own first, before the board is
      // looked up
      assertAllowed(await allowReport(networks, now), 'TOO_MANY_REQUESTS')
      const link = { kitaToken, boardId }
      const target = await boardOf(link, now)
      const budgetKey = boardBudgetKey(link)
      assertAllowed(
        await allowClientBoardReport(client, budgetKey, now),
        'TOO_MANY_REQUESTS',
      )
      assertAllowed(
        await allowClientNoteReport(client, noteId, now),
        'TOO_MANY_REQUESTS',
      )

      // The board's budget, the report and its mails belong together: a note
      // that is gone rolls all of it back. So does a note or board the
      // operator has heard of often enough today.
      const { created, reported } = await db.transaction(async (tx) => {
        const found = await reportedNote(tx, target.id, noteId, now)
        if (!found) throw new ActionError({ code: 'NOT_FOUND' })
        assertAllowed(
          await allowBoardReport(budgetKey, now, tx),
          'TOO_MANY_REQUESTS',
        )
        if (operator) {
          assertAllowed(
            await allowOperatorReport(
              noteId,
              budgetKey,
              operatorReportAddress(),
              now,
              tx,
            ),
            'TOO_MANY_REQUESTS',
          )
        }
        const filed = await fileReport(
          tx,
          { organizationId: target.organizationId, boardId: target.id },
          found,
          { reason, remarks },
          now,
        )
        return { ...filed, reported: found }
      })
      if (created) reportMailer.schedule(target.organizationId)
      if (!operator) return undefined
      const { sent, receiptSent } = await sendOperatorReport(
        {
          link,
          board: target,
          reported,
          reason,
          remarks,
          notifier: operator,
        },
        context.request,
        now,
      )
      return {
        operatorNotified: sent,
        receiptSent,
      } satisfies OperatorReportOutcome
    },
  }),

  // Works on a board of a paused Kita as well, and never asks whether the
  // Kita is paused: whoever pinned a note with their contact details takes it
  // down whenever they want — on the board behind the link, with the note's
  // key, in one statement.
  remove: defineAction({
    input: z.object({
      ...boardLink,
      noteId: z.string().max(64),
      deleteKey: z.string().max(64),
    }),
    handler: async (
      { kitaToken, boardId, noteId, deleteKey },
      context: ActionAPIContext,
    ) => {
      const client = visitorClient(context)
      if (!(await allowNoteRemoval(client))) {
        throw new ActionError({
          code: 'TOO_MANY_REQUESTS',
          message:
            'Von hier aus wurden gerade sehr viele Zettel entfernt. Bitte versuch es gleich nochmal.',
        })
      }
      if (!isLinkToken(kitaToken)) throw new ActionError({ code: 'NOT_FOUND' })
      const linked = linkedBoardIds(kitaToken, eq(board.id, boardId))
      assertFound(
        await db
          .delete(note)
          .where(
            and(
              eq(note.id, noteId),
              inArray(note.boardId, linked),
              eq(note.deleteKeyHash, hashDeleteKey(deleteKey)),
            ),
          )
          .returning({ id: note.id }),
      )
    },
  }),
}
