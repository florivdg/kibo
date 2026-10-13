import type { ActionAPIContext } from 'astro:actions'

// The context an action runs in, as far as Kibo's actions read it: the
// session the middleware verified (boards.*), and the request's network
// (notes.*, push.*). Used as `action.orThrow.call(context, input)`.

// A request signed in as this account, with `organizationId` as the active
// Kita (none without)
export function signedInContext(userId: string, organizationId?: string) {
  return {
    locals: { user: { id: userId }, organizationId },
  } as unknown as ActionAPIContext
}

// An admin request: signed in, with `organizationId` as the active Kita
export function adminContext(organizationId: string) {
  return signedInContext('test-user', organizationId)
}

// A visitor's request from the given address
export function visitorContext(address: string) {
  return {
    locals: {},
    clientAddress: address,
    request: new Request('http://localhost:4321/_actions/test', {
      method: 'POST',
      headers: { 'x-forwarded-for': address },
    }),
  } as unknown as ActionAPIContext
}

// What an action answered when it refused: code, status and message of its
// ActionError; null when it went through
export async function refusal(call: Promise<unknown>) {
  try {
    await call
    return null
  } catch (error) {
    const { code, status, message } = error as {
      code?: string
      status?: number
      message?: string
    }
    if (typeof code !== 'string') throw error
    return { code, status, message }
  }
}
