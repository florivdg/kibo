import { APIError } from 'better-auth/api'

import { auth } from '@/lib/auth'
import { findPendingInvitation } from '@/lib/organization-members'

// What the invitation page shows to whoever opened the link
export type InvitationView =
  // No such invitation, or it is over: expired, withdrawn, already answered
  | { state: 'gone' }
  // Nobody signed in. The Kita's name is all the page gives away — never
  // the address the invitation went to.
  | { state: 'guest'; id: string; organizationName: string }
  // Signed in, but with an account the invitation wasn't meant for
  | { state: 'wrong-account' }
  | {
      state: 'recipient'
      id: string
      organizationName: string
      inviterName: string
    }

// Whether the signed-in account may answer the invitation is Better Auth's
// call: the same check that accepting will run (the invited address, and a
// confirmed one)
async function recipientState(id: string, headers: Headers) {
  try {
    await auth.api.getInvitation({ headers, query: { id } })
    return 'recipient'
  } catch (error) {
    if (!(error instanceof APIError)) throw error
    const code: unknown = error.body?.code
    return code === 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION'
      ? 'wrong-account'
      : 'gone'
  }
}

// `headers` carry the session when there is one (`signedIn`). Opening the
// link never creates one: accepting takes the normal login, TOTP included.
export async function invitationView(
  id: string | null,
  signedIn: boolean,
  headers: Headers,
): Promise<InvitationView> {
  const invitation = id ? await findPendingInvitation(id) : undefined
  if (!invitation) return { state: 'gone' }
  const { organizationName, inviterName } = invitation
  if (!signedIn) return { state: 'guest', id: invitation.id, organizationName }

  const state = await recipientState(invitation.id, headers)
  return state === 'recipient'
    ? { state, id: invitation.id, organizationName, inviterName }
    : { state }
}
