import { DATABASE_URL } from 'astro:env/server'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

const pool = new Pool({
  connectionString: DATABASE_URL,
  // One process serves every request; Postgres' default of 100 connections
  // leaves room for the migration job, backups and a second instance
  max: 10,
  // A database that doesn't answer should fail the request, not hold it: the
  // health check turns red and the proxy stops waiting
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // Nothing Kibo asks takes more than a fraction of a second. A statement
  // that runs for 15 s is stuck, and Postgres cancels it; the client-side
  // timeout is the net for a server that doesn't answer at all.
  statement_timeout: 15_000,
  query_timeout: 20_000,
})

// An idle connection can die at any time (Postgres restart, backup, network).
// Without a listener, pg turns that into an uncaught 'error' event and takes
// the whole server down — while the pool itself would simply open a new
// connection for the next query. Only the message is logged: the error object
// carries the pool's configuration, password included.
pool.on('error', (error: Error) => {
  console.error(`[db] Verbindung im Pool verloren: ${error.message}`)
})

export const db = drizzle({ client: pool, schema })

// Ends the pool once the queries still running have finished. Called on
// SIGTERM (src/lib/server/runtime.ts) so a container restart doesn't leave
// half-written transactions and Postgres connections behind.
export function closeDatabase() {
  return pool.end()
}
