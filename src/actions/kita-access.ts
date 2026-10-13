import { ActionError } from 'astro:actions'

import { isKitaPaused } from '@/lib/hosted/access'
import {
  HOSTED_PAUSED_ADMIN,
  HOSTED_PAUSED_VISITOR,
} from '@/lib/hosted/messages'

// What the hosted instance refuses a paused Kita (src/lib/hosted/access.ts):
// 402, a code of its own, so the browser can tell it from "not your Kita"
// (403), with the sentence its audience reads (src/lib/hosted/messages.ts).
// Without HOSTED neither of the two ever throws.
function paused(message: string) {
  return new ActionError({ code: 'PAYMENT_REQUIRED', message })
}

// boards.*: the admins of a paused Kita change nothing about its boards.
// Looks the subscription up, on the hosted instance only.
export async function assertKitaWritable(organizationId: string) {
  if (await isKitaPaused(organizationId)) throw paused(HOSTED_PAUSED_ADMIN)
}

// notes.*: a board of a paused Kita is closed to its visitors. The answer
// came with the board (findLinkedBoard in src/lib/board/queries.ts).
export function assertBoardOpen(board: { paused: boolean }) {
  if (board.paused) throw paused(HOSTED_PAUSED_VISITOR)
}
