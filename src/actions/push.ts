import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'

import { timestamp } from '@/actions/timestamp'
import {
  boardLink,
  kitaToken,
  pushEndpoint,
  visitorClient,
} from '@/actions/visitor'
import {
  subscribeToBoard,
  syncSubscriptions,
  unsubscribeFromBoard,
  type PushRefusal,
} from '@/lib/push/subscriptions'

function answer<T extends { ok: true }>(outcome: T | PushRefusal): T {
  if (!outcome.ok) {
    throw new ActionError({ code: outcome.code, message: outcome.message })
  }
  return outcome
}

// The browser's push subscription: one endpoint and its keys
const browserSubscription = {
  endpoint: pushEndpoint,
  keys: z.object({
    p256dh: z.string().max(128),
    auth: z.string().max(64),
  }),
}

// Public, like notes.*: anyone with the Kita link may ask to be notified,
// board by board. The rules live in src/lib/push/subscriptions.ts.
export const push = {
  // Once per page load: which of the Kita's boards this browser follows,
  // with its keys refreshed, the number for the app's icon and whether the
  // endpoint still follows any board anywhere (if not, the page ends the
  // browser's subscription). Adds nothing. A board page sends its board and
  // the newest point up to which it shows every note (its server time, or
  // the newest note of a page loaded since), which counts as seen up to
  // there — also again whenever that moves.
  sync: defineAction({
    input: z.object({
      kitaToken,
      seen: z
        .object({
          boardId: boardLink.boardId,
          until: timestamp.transform((value) => new Date(value)),
        })
        .optional(),
      ...browserSubscription,
    }),
    handler: async (input, context: ActionAPIContext) => {
      const { boardIds, unseen, remaining } = answer(
        await syncSubscriptions(input, visitorClient(context)),
      )
      return { boardIds, unseen, remaining }
    },
  }),

  subscribe: defineAction({
    input: z.object({ ...boardLink, ...browserSubscription }),
    handler: async (input, context: ActionAPIContext) => {
      answer(await subscribeToBoard(input, visitorClient(context)))
      return { subscribed: true as const }
    },
  }),

  unsubscribe: defineAction({
    input: z.object({ ...boardLink, endpoint: pushEndpoint }),
    handler: async (input, context: ActionAPIContext) => {
      const { unseen, remaining } = answer(
        await unsubscribeFromBoard(input, visitorClient(context)),
      )
      return { subscribed: false as const, unseen, remaining }
    },
  }),
}
