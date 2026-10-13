import { randomUUID } from 'node:crypto'

import { inArray, like } from 'drizzle-orm'

import { createUser } from '../../scripts/admin/create-user'

import { rateLimit, user } from '@/db/schema'
import { auth } from '@/lib/auth'

import { testDb } from './spam-db'

// The auth handler as the browser calls it (src/lib/auth.ts), against the
// local PostgreSQL: accounts that are signed in, and JSON requests to
// /api/auth.

const ORIGIN = 'http://localhost:4321'
export const PASSWORD = 'richtig-langes-passwort'

export interface Account {
  id: string
  email: string
  // The session cookie of a fresh sign-in, as a browser would send it back
  cookie: string
}

export interface Answer {
  status: number
  code?: string
  data: Record<string, unknown> | null
  headers: Headers
}

// Just what the tests compare
export async function answer(request: Promise<Answer>) {
  const { status, code } = await request
  return { status, code }
}

async function signIn(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    headers: new Headers(),
    returnHeaders: true,
  })
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

// One per test file. Better Auth counts per network and route in the database
// the dev server uses too. Each request comes from an address of its own out
// of `network` — the first three octets of a documentation range no other
// file uses — so neither a second run nor the dev server's own budget is in
// the way; resetRateLimit removes the counters again. `prefix` starts the
// address of every account made here, and removeAccounts deletes them.
export function authRequests(network: string, prefix: string) {
  const emails: string[] = []
  let requests = 0

  function resetRateLimit() {
    return testDb.delete(rateLimit).where(like(rateLimit.key, `${network}%`))
  }

  function newEmail(domain = 'kita.example') {
    const email = `${prefix}-${randomUUID()}@${domain}`
    emails.push(email)
    return email
  }

  // A confirmed account that is signed in
  async function newAccount(
    domain?: string,
    name = 'Anna Beispiel',
  ): Promise<Account> {
    const email = newEmail(domain)
    const { id } = await createUser({
      db: testDb,
      email,
      name,
      password: PASSWORD,
      env: {},
      now: new Date(),
    })
    return { id, email, cookie: await signIn(email) }
  }

  // A request to /api/auth/<path>, the way the browser sends it
  async function send(
    path: string,
    {
      body,
      cookie,
      address,
    }: { body?: Record<string, unknown>; cookie?: string; address?: string },
  ): Promise<Answer> {
    // Spinning the last octet over a whole run; a route never sees one twice
    // often enough to reach its limit
    requests += 1
    if (requests % 250 === 0) await resetRateLimit()
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          origin: ORIGIN,
          'x-forwarded-for': address ?? `${network}${requests % 250}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body && JSON.stringify(body),
      }),
    )
    const data = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    const code = typeof data?.code === 'string' ? data.code : undefined
    return { status: response.status, code, data, headers: response.headers }
  }

  // `address` pins the request to one client, for what is counted per
  // network; fixedClient below is one the spinning never reaches
  function post(
    path: string,
    body: Record<string, unknown>,
    cookie?: string,
    address?: string,
  ) {
    return send(path, { body, cookie, address })
  }

  function get(path: string, cookie?: string) {
    return send(path, { cookie })
  }

  function removeAccounts() {
    return testDb.delete(user).where(inArray(user.email, emails))
  }

  return {
    fixedClient: `${network}251`,
    get,
    newAccount,
    newEmail,
    post,
    removeAccounts,
    resetRateLimit,
  }
}
