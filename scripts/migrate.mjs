// Applies the migrations in drizzle/ and says what happened — the container
// this runs in is the one an operator looks at when an update stops
// (`docker compose logs migrate`), so a silent exit code is not enough.
//
// Deliberately not the drizzle-kit CLI: it swallows the database's error
// message and just exits 1. Local development keeps using `bun run db:migrate`.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const MIGRATIONS_FOLDER = 'drizzle'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate] DATABASE_URL fehlt')
  process.exit(1)
}

// Messages only: an error object from pg carries the pool's configuration,
// password included. drizzle wraps the driver error, and the wrapper just
// names the query — what actually went wrong is the cause.
function reason(error) {
  if (!(error instanceof Error)) return 'unbekannter Fehler'
  const { cause } = error
  return cause instanceof Error
    ? `${cause.message} (${error.message.split('\n')[0]})`
    : error.message
}

const pool = new Pool({ connectionString: url })

try {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
  console.info('[migrate] Datenbank ist auf dem aktuellen Stand')
} catch (error) {
  console.error(`[migrate] Migration fehlgeschlagen: ${reason(error)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
