import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type * as schema from './schema'

// The database as drizzle knows it, whoever holds the connection: the app's
// pool (src/db/index.ts), the one client of scripts/admin.ts, or the tests'.
// Types only — importing this file loads neither `astro:env` nor a driver.
export type Database = NodePgDatabase<typeof schema>

// Either the database or a running transaction, for statements that can be
// pointed at the caller's transaction
export type Executor =
  Database | Parameters<Parameters<Database['transaction']>[0]>[0]
