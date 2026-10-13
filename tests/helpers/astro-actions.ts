import type { ActionAPIContext } from 'astro:actions'
import type { z } from 'astro/zod'

// What stands in for `astro:actions` in the tests (tests/preload.ts): Astro's
// own runtime only loads inside its build. Just enough of it to run an action
// on the server the way Astro does — `action.orThrow.call(context, input)`
// parses the input with the action's schema and hands both to the handler.

// The codes Kibo answers with, and their HTTP status
const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

export class ActionError extends Error {
  code: string
  status: number

  constructor({ code, message }: { code: string; message?: string }) {
    super(message ?? code)
    this.code = code
    this.status = STATUS[code] ?? 500
  }
}

export function defineAction<Input, Output>({
  input,
  handler,
}: {
  input?: z.ZodType<Input>
  handler: (input: Input, context: ActionAPIContext) => Promise<Output>
}) {
  return {
    orThrow(this: ActionAPIContext, raw: unknown) {
      return handler(input ? input.parse(raw) : (raw as Input), this)
    },
  }
}
