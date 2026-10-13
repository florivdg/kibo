import {
  defineRequestState,
  getCurrentAuthEndpointContext,
  runWithTransaction,
  type AuthEndpointContext,
} from '@better-auth/core/context'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { passkey as passkeyPlugin } from '@better-auth/passkey'
import { resetPassword, type createAuthMiddleware } from 'better-auth/api'
import { desc, eq } from 'drizzle-orm'

import { db } from '@/db'
import * as schema from '@/db/schema'
import type { Executor } from '@/db/types'

// The reset callback and registration budget must use the same transaction
// as Better Auth's adapter, rather than the app's pool.
export const passkeyTransaction = defineRequestState<Executor | null>(
  () => null,
)

type Endpoint = (...args: never[]) => Promise<unknown>
type UserIdOf = (ctx: AuthEndpointContext) => Promise<string | undefined>

// Keep the raw endpoint's path, options and call signature. Better Auth runs
// its global hooks before calling this wrapper, and its endpoint middleware
// inside it. Both HTTP and auth.api calls therefore take the same lock.
function transactional<E extends Endpoint>(
  endpoint: E,
  userIdOf: UserIdOf,
  recheck?: ReturnType<typeof createAuthMiddleware>,
) {
  const call = endpoint as unknown as (...args: Parameters<E>) => ReturnType<E>
  const wrapped = async (...args: Parameters<E>) => {
    const ctx = getCurrentAuthEndpointContext()
    const userId = await userIdOf(ctx)
    // Let the original endpoint answer malformed tokens/credentials and
    // requests without a session, with its usual errors.
    if (!userId) return call(...args)

    const adapter = ctx.context.adapter
    const transactionalAdapter: typeof adapter = {
      ...adapter,
      transaction: (callback) =>
        db.transaction(async (on) => {
          // Registration, passkey sign-in and reset always lock user first.
          // Reset holds this through password update, passkey deletion and
          // session revocation; a registration cannot commit behind its cleanup.
          await on
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, userId))
            .for('update')
          ctx.context.adapter = drizzleAdapter(on, {
            provider: 'pg',
            schema,
          })(ctx.context.options)
          // The before hook may have read a session before waiting for the lock.
          // Re-read it under the lock, so a reset's revoked session cannot pass.
          ctx.context.session = null
          await passkeyTransaction.set(on)
          return callback(ctx.context.adapter)
        }),
    }
    try {
      return await runWithTransaction(transactionalAdapter, async () => {
        // Check the password and cap again while holding the lock. The
        // endpoint has not stripped the password from the raw body yet.
        if (recheck) await recheck(ctx)
        return call(...args)
      })
    } finally {
      await passkeyTransaction.set(null)
      ctx.context.adapter = adapter
    }
  }
  return Object.assign(wrapped, endpoint)
}

async function resetUser(ctx: AuthEndpointContext) {
  const token: unknown = ctx.body?.token || ctx.query?.token
  if (typeof token !== 'string' || !token) return undefined
  const [row] = await db
    .select({ userId: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, `reset-password:${token}`))
    .orderBy(desc(schema.verification.createdAt))
    .limit(1)
  return row?.userId
}

async function authenticatingUser(ctx: AuthEndpointContext) {
  const id: unknown = ctx.body?.response?.id
  if (typeof id !== 'string') return undefined
  const [row] = await db
    .select({ userId: schema.passkey.userId })
    .from(schema.passkey)
    .where(eq(schema.passkey.credentialID, id))
  return row?.userId
}

export function withPasskeyTransactions(
  plugin: ReturnType<typeof passkeyPlugin>,
  checkRegistration: ReturnType<typeof createAuthMiddleware>,
) {
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      verifyPasskeyRegistration: transactional(
        plugin.endpoints.verifyPasskeyRegistration,
        async (ctx) => ctx.context.session?.user.id,
        checkRegistration,
      ),
      verifyPasskeyAuthentication: transactional(
        plugin.endpoints.verifyPasskeyAuthentication,
        authenticatingUser,
      ),
      // Override the core endpoint while preserving its schema and handler.
      resetPassword: transactional(resetPassword, resetUser),
    },
  }
}
