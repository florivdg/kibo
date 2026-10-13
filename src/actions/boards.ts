import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import { and, eq, inArray } from 'drizzle-orm'

import { assertFound } from '@/actions/assert-found'
import { assertKitaWritable } from '@/actions/kita-access'
import { noteCursor } from '@/actions/note-cursor'
import { optionalText, requiredText } from '@/actions/text-fields'
import { db } from '@/db'
import { board, note } from '@/db/schema'
import { BOARD_TYPE_IDS } from '@/lib/board/board-types'
import {
  deleteBoard,
  renewKitaLink,
  setBoardPushEnabled,
} from '@/lib/board/mutations'
import { notePage, organizationBoard } from '@/lib/board/queries'
import { BOARD_DESCRIPTION_MAX, BOARD_NAME_MAX } from '@/lib/board/types'

// The middleware verifies the session and Kita membership for boards.*.
// Every member of a Kita administers it.
function activeOrganizationId({ locals }: ActionAPIContext) {
  if (!locals.user) throw new ActionError({ code: 'UNAUTHORIZED' })
  if (!locals.organizationId) throw new ActionError({ code: 'FORBIDDEN' })
  return locals.organizationId
}

// The same, for everything that changes a board: a Kita the hosted instance
// has paused can still read its notes (listNotes) and take them down
// (removeNote), nothing more
async function writableOrganizationId(context: ActionAPIContext) {
  const organizationId = activeOrganizationId(context)
  await assertKitaWritable(organizationId)
  return organizationId
}

const boardId = z.string().max(64)
const details = {
  name: requiredText(BOARD_NAME_MAX),
  description: optionalText(BOARD_DESCRIPTION_MAX, { multiline: true }),
}

// Admin: manage the boards of the active Kita
export const boards = {
  create: defineAction({
    input: z.object({ type: z.enum(BOARD_TYPE_IDS), ...details }),
    handler: async (input, context) => {
      const organizationId = await writableOrganizationId(context)
      const [created] = await db
        .insert(board)
        .values({ ...input, organizationId })
        .returning({ id: board.id })
      return created!
    },
  }),

  update: defineAction({
    input: z.object({ id: boardId, ...details }),
    handler: async ({ id, ...input }, context) => {
      const organizationId = await writableOrganizationId(context)
      assertFound(
        await db
          .update(board)
          .set(input)
          .where(organizationBoard(organizationId, id))
          .returning({ id: board.id }),
      )
    },
  }),

  // A new Kita link, e.g. when the old one was shared too widely: every link,
  // QR code and installed app of the Kita stops working, and so do the
  // notifications of everyone who subscribed through it — one still waiting
  // to go out included. The notes stay.
  renewKitaLink: defineAction({
    handler: async (_input, context) => {
      const organizationId = await writableOrganizationId(context)
      await renewKitaLink(organizationId)
    },
  }),

  // Whether visitors may turn on notifications; off removes the existing
  // subscriptions
  setPushEnabled: defineAction({
    input: z.object({ id: boardId, enabled: z.boolean() }),
    handler: async ({ id, enabled }, context) => {
      const organizationId = await writableOrganizationId(context)
      assertFound(await setBoardPushEnabled(organizationId, id, enabled))
    },
  }),

  remove: defineAction({
    input: z.object({ id: boardId }),
    handler: async ({ id }, context) => {
      const organizationId = await writableOrganizationId(context)
      assertFound(await deleteBoard(organizationId, id))
    },
  }),

  // Older notes of one of the Kita's boards, one page at a time
  listNotes: defineAction({
    input: z.object({ id: boardId, cursor: noteCursor }),
    handler: async ({ id, cursor }, context) => {
      const organizationId = activeOrganizationId(context)
      const [found] = await db
        .select({ id: board.id })
        .from(board)
        .where(organizationBoard(organizationId, id))
      if (!found) throw new ActionError({ code: 'NOT_FOUND' })
      return notePage(found.id, new Date(), cursor)
    },
  }),

  // Stays possible while the Kita is paused: a note with somebody's contact
  // details has to be removable at any time
  removeNote: defineAction({
    input: z.object({ noteId: z.string().max(64) }),
    handler: async ({ noteId }, context) => {
      const organizationId = activeOrganizationId(context)
      const organizationBoards = db
        .select({ id: board.id })
        .from(board)
        .where(eq(board.organizationId, organizationId))
      assertFound(
        await db
          .delete(note)
          .where(
            and(eq(note.id, noteId), inArray(note.boardId, organizationBoards)),
          )
          .returning({ id: note.id }),
      )
    },
  }),
}
