// Config entry for `bun run auth:generate` only. The runtime config in
// src/lib/auth.ts imports `astro:env`, which the Better Auth CLI can't load.
import { betterAuth } from 'better-auth'

import { authOptions } from '../src/lib/auth-options'

export const auth = betterAuth(authOptions)
