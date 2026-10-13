import { findInvalidTrustedProxies } from '@better-auth/core/utils/ip'
import { TRUSTED_PROXIES } from 'astro:env/server'

// The reverse proxies in front of Kibo, as IPs or CIDR ranges. Read once and
// shared by the note budgets (src/lib/spam/) and Better Auth's rate limits
// (src/lib/auth.ts), so both see the same client address.
// Documented in docs/selbst-hosten/spam-schutz.md.
const entries = TRUSTED_PROXIES.split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

// scripts/server.mjs refuses to start with an invalid entry. This is the net
// for `astro dev`: an entry nobody can parse would silently trust nothing.
const invalid = findInvalidTrustedProxies(entries)
if (invalid.length) {
  console.error(
    `[server] TRUSTED_PROXIES enthält ungültige Einträge, sie werden ignoriert: ${invalid.join(', ')}`,
  )
}

export const trustedProxies = entries.filter(
  (entry) => !invalid.includes(entry),
)
