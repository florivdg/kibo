import type { APIRoute } from 'astro'
import { sql } from 'drizzle-orm'

import { db } from '@/db'

export const prerender = false

function answer(status: 'ok' | 'error', code: number) {
  return new Response(JSON.stringify({ status }), {
    status: code,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

// Container health check and monitoring: green only when the database answers,
// because without it no page works. The endpoint is reachable from the whole
// proxy network, so the answer is the status code and nothing else — which
// part of the stack is failing belongs in the server log, not on the wire.
export const GET: APIRoute = async () => {
  try {
    await db.execute(sql`select 1`)
    return answer('ok', 200)
  } catch (error) {
    // Just the reason, not the error object: that one can carry the pool's
    // configuration including the password
    const reason = error instanceof Error ? error.message : 'unbekannter Fehler'
    console.error(`[health] Datenbank nicht erreichbar: ${reason}`)
    return answer('error', 503)
  }
}
