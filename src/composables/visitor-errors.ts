import type { SubmitError } from '@/composables/use-form-submit'

// Messages for visitors, who are addressed with "du"
export function messagesFor(messages: Record<string, string>) {
  return (error: SubmitError) =>
    (error.code && messages[error.code]) ??
    'Das hat nicht geklappt. Bitte versuch es nochmal.'
}

// The spam rules phrase their own message, including how long to wait; the
// form keeps its content either way, so the visitor only has to wait.
const SPAM_CODES = new Set(['TOO_MANY_REQUESTS', 'CONFLICT'])

export function withSpamMessages(fallback: (error: SubmitError) => string) {
  return (error: SubmitError) =>
    (error.code && SPAM_CODES.has(error.code) && error.message) ||
    fallback(error)
}
