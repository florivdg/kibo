import type { ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'

import { noteClientNetworks } from '@/lib/spam/guard'

// What the public actions (notes.*, push.*) share

// The secret of a Kita link. Only bounded here: a malformed one finds no Kita
// and gets 404 like an unknown one (isLinkToken: the database isn't even
// asked).
export const kitaToken = z.string().min(1).max(64)

// A board as the public actions name it: the Kita link it was opened
// through, and its id within that Kita (src/lib/board/kita-link.ts)
export const boardLink = {
  kitaToken,
  boardId: z.string().min(1).max(64),
}

// Push services hand out endpoints of a few hundred characters
export const pushEndpoint = z.string().min(1).max(2048)

// The network the request came from with the wider IPv6 networks it sits
// in, for the budgets of posting and reporting …
export function visitorNetworks({ request, clientAddress }: ActionAPIContext) {
  return noteClientNetworks(request, clientAddress)
}

// … and the network alone, for every other spam budget
export function visitorClient(context: ActionAPIContext) {
  return visitorNetworks(context).client
}
