import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'

import { mayHandleReports } from '@/lib/reports/access'
import { closeCase } from '@/lib/reports/mutations'

// Admin: the reported notes of the active Kita (/admin/reports). The
// middleware verifies the session for reports.* and that the active Kita is
// one of the user's; on top of that, every call asks whether the user is an
// owner or admin there, and every case is looked up within that Kita only —
// the id of another Kita's case finds nothing. Unlike boards.*, nothing here
// asks whether the hosted instance has paused the Kita: a reported note must
// be removable at any time, like any other.
async function handlingOrganization({ locals }: ActionAPIContext) {
  const { user, organizationId } = locals
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED' })
  if (!organizationId || !(await mayHandleReports(organizationId, user.id))) {
    throw new ActionError({ code: 'FORBIDDEN' })
  }
  return { organizationId, userId: user.id }
}

export const reports = {
  // Closes an open case: with the note taken down in the same step, or with
  // it left on the board. A note that is gone already doesn't stand in the
  // way. A case that was closed meanwhile — by someone else of the team —
  // answers 404 like one that isn't the Kita's.
  close: defineAction({
    input: z.object({
      caseId: z.string().max(64),
      removeNote: z.boolean(),
    }),
    handler: async ({ caseId, removeNote }, context) => {
      const { organizationId, userId } = await handlingOrganization(context)
      const closed = await closeCase(
        organizationId,
        caseId,
        { userId, removeNote },
        new Date(),
      )
      if (!closed) throw new ActionError({ code: 'NOT_FOUND' })
      return closed
    },
  }),
}
