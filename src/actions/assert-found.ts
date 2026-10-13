import { ActionError } from 'astro:actions'

// For writes that return the affected rows: none means nothing matched
export function assertFound(rows: unknown[]) {
  if (!rows.length) throw new ActionError({ code: 'NOT_FOUND' })
}
