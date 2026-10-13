import { APIError } from 'better-auth/api'

// What a check of Kibo's turned an attempt away with, as the tests compare
// it: the status and code of the APIError it threw. Anything else is no
// refusal but a bug, and thrown on.
export function apiRefusal(error: unknown) {
  if (!(error instanceof APIError)) throw error
  return { status: error.statusCode, code: error.body?.code }
}
