import { lt } from 'drizzle-orm'

import { db } from '@/db'
import { rateLimit, session, verification } from '@/db/schema'
import { authOptions } from '@/lib/auth-options'
import { errorMessage } from '@/lib/error-message'

// Rows Better Auth leaves behind once they expired, deleted on the server's
// hourly timer (src/lib/server/runtime.ts). Each table on its own, so one
// failure doesn't keep the other from going.
async function purge(what: string, remove: () => Promise<unknown>) {
  try {
    await remove()
  } catch (error) {
    console.error(
      `[auth] Löschen abgelaufener ${what} fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}

// Better Auth ignores an expired session and deletes it only when its token
// comes back. Sessions carry the IP address and user agent of the sign-in, so
// the ones nobody returns with are deleted here instead.
export async function purgeExpiredSessions(now: Date) {
  await purge('Sitzungen', () =>
    db.delete(session).where(lt(session.expiresAt, now)),
  )
}

// Better Auth deletes an expired verification row only when something looks
// it up by its identifier again. The passkey challenges never are: every view
// of the login page stores one for the suggestion in the e-mail field, and the
// plugin consumes it only when a passkey is actually used. What is left over
// is deleted here, together with the links nobody followed.
export async function purgeExpiredVerifications(now: Date) {
  await purge('Bestätigungen', () =>
    db.delete(verification).where(lt(verification.expiresAt, now)),
  )
}

// The longest window of Better Auth's rate limits as Kibo configures them
// (src/lib/auth-options.ts: the default, the custom rules, the plugins'
// own), in milliseconds. Better Auth's built-in rules are shorter still.
export const LONGEST_RATE_LIMIT_WINDOW_MS =
  Math.max(
    authOptions.rateLimit.window,
    ...Object.values(authOptions.rateLimit.customRules).map(
      (rule) => rule.window,
    ),
    ...authOptions.plugins.flatMap((plugin) =>
      'rateLimit' in plugin && Array.isArray(plugin.rateLimit)
        ? plugin.rateLimit.map((rule: { window: number }) => rule.window)
        : [],
    ),
  ) * 1000

// Past the longest window a row counts for nothing: the next request starts
// a new window anyway. The margin covers clocks of several processes that
// don't quite agree.
const RATE_LIMIT_MARGIN_MS = 5 * 60 * 1000

// Better Auth's rate-limit rows key `IP|path` in clear (IPv6 cut to /64), one
// per network and route. Better Auth only clears out old ones when a later
// request opens a new window, so on a quiet instance they would stay; here
// they go once their window is over — at most about two hours after the
// last request, with the hourly beat.
export async function purgeStaleRateLimits(now: Date) {
  const cutoff =
    now.getTime() - LONGEST_RATE_LIMIT_WINDOW_MS - RATE_LIMIT_MARGIN_MS
  await purge('Anfragezähler', () =>
    db.delete(rateLimit).where(lt(rateLimit.lastRequest, cutoff)),
  )
}
