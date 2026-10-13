import { APIError } from 'better-auth/api'

import { ACCOUNT_NAME_MAX } from '@/lib/limits'
import { isPlainText, looksLikeLink } from '@/lib/plain-text'

// Better Auth takes any string as the name; Kibo wants one line a person
// could have typed, of a length that fits a greeting.
// Addresses have no business in a name. The name opens every mail Kibo sends,
// and sign-up mails go to whatever address was typed in — without this, a
// stranger could put a link of their choosing into a mail from Kibo.
export function assertAccountName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!isPlainText(name, ACCOUNT_NAME_MAX) || looksLikeLink(name)) {
    throw APIError.fromStatus('BAD_REQUEST', {
      code: 'INVALID_NAME',
      message: 'Invalid name',
    })
  }
}
