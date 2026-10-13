import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import {
  targetOrigin,
  validateManifest,
  type Environment,
  type Manifest,
  type Fixture,
} from '../../tests/load/helpers/config'

export function makeManifest(
  environment: Environment,
  origin: string,
): Manifest {
  const runId = crypto.randomUUID()
  const createdAt = Date.now()
  return {
    version: 1,
    runId,
    ownerId: crypto.randomUUID(),
    environment,
    origin: targetOrigin(origin, environment),
    expiresAt: new Date(createdAt + 86400000).toISOString(),
    fixtures: (['empty', 'typical', 'large'] as const).map((shape, index) => ({
      id: crypto.randomUUID(),
      boardId: crypto.randomUUID(),
      token: randomBytes(16).toString('base64url'),
      shape,
      count: [0, 12, 240][index]!,
      name: `Kibo Lasttest ${runId} ${shape}`,
    })),
  }
}
async function insertNotes(
  client: PoolClient,
  fixture: Fixture,
  expiresAt: string,
) {
  const now = Date.now()
  for (let index = 0; index < fixture.count; index++) {
    const id = crypto.randomUUID()
    const createdAt = new Date(now - index * 1000).toISOString()
    await client.query(
      "INSERT INTO note (id,board_id,category_id,title,body,author,delete_key_hash,created_at,expires_at) VALUES ($1,$2,'hinweis',$3,$4,'Testperson',$5,$6,$7)",
      [
        id,
        fixture.boardId,
        `Synthetischer Zettel ${index}`,
        'Künstlicher Inhalt. '.repeat(40),
        randomBytes(32).toString('hex'),
        createdAt,
        expiresAt,
      ],
    )
    if (index === 39) fixture.cursor = { id, createdAt }
  }
}
async function insertFixture(
  client: PoolClient,
  fixture: Fixture,
  manifest: Manifest,
) {
  await client.query(
    'INSERT INTO organization (id,name,slug,created_at,metadata) VALUES ($1,$2,$3,now(),$4)',
    [
      fixture.id,
      fixture.name,
      `kibo-load-${manifest.runId}-${fixture.shape}`,
      JSON.stringify({ kiboLoadTest: manifest.runId }),
    ],
  )
  await client.query(
    "INSERT INTO member (id,organization_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',now())",
    [crypto.randomUUID(), fixture.id, manifest.ownerId],
  )
  await client.query(
    'INSERT INTO kita_link (organization_id,token) VALUES ($1,$2)',
    [fixture.id, fixture.token],
  )
  await client.query(
    "INSERT INTO board (id,organization_id,type,name,description,push_enabled) VALUES ($1,$2,'pinnwand','Synthetisches Brett','Nur künstliche Testdaten',false)",
    [fixture.boardId, fixture.id],
  )
}
export async function provision(
  pool: Pool,
  manifest: Manifest,
  path: string,
  hosted: boolean,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)',
      [
        manifest.ownerId,
        `Kibo Lasttest ${manifest.runId}`,
        `${manifest.runId}@loadtest.invalid`,
      ],
    )
    if (hosted)
      await client.query(
        'INSERT INTO hosted_subscription (user_id,trial_ends_at,complimentary) VALUES ($1,now(),true)',
        [manifest.ownerId],
      )
    for (const fixture of manifest.fixtures) {
      await insertFixture(client, fixture, manifest)
      await insertNotes(client, fixture, manifest.expiresAt)
    }
    validateManifest(manifest)
    // Save recovery journal BEFORE commit. A lost connection/interrupt can
    // leave either committed rows or none; cleanup is idempotent for both.
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
async function cleanupFixture(
  client: PoolClient,
  fixture: Fixture,
  manifest: Manifest,
) {
  const rows = await client.query(
    'SELECT name,slug,metadata FROM organization WHERE id=$1 FOR UPDATE',
    [fixture.id],
  )
  if (!rows.rowCount) return
  const row = rows.rows[0]
  if (
    row.name !== fixture.name ||
    row.slug !== `kibo-load-${manifest.runId}-${fixture.shape}` ||
    row.metadata !== JSON.stringify({ kiboLoadTest: manifest.runId })
  )
    throw new Error('Cleanup identity mismatch')
  const members = await client.query(
    'SELECT user_id,role FROM member WHERE organization_id=$1',
    [fixture.id],
  )
  if (
    members.rowCount !== 1 ||
    members.rows[0].user_id !== manifest.ownerId ||
    members.rows[0].role !== 'owner'
  )
    throw new Error('Cleanup membership mismatch')
  await client.query('DELETE FROM organization WHERE id=$1', [fixture.id])
}
export async function cleanup(pool: Pool, manifest: Manifest) {
  validateManifest(manifest)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const fixture of manifest.fixtures) {
      await cleanupFixture(client, fixture, manifest)
    }
    const owner = await client.query(
      'SELECT name,email FROM "user" WHERE id=$1 FOR UPDATE',
      [manifest.ownerId],
    )
    if (owner.rowCount) {
      if (
        owner.rows[0].name !== `Kibo Lasttest ${manifest.runId}` ||
        owner.rows[0].email !== `${manifest.runId}@loadtest.invalid`
      )
        throw new Error('Cleanup owner mismatch')
      const memberships = await client.query(
        'SELECT id FROM member WHERE user_id=$1',
        [manifest.ownerId],
      )
      if (memberships.rowCount) throw new Error('Cleanup owner still in use')
      await client.query('DELETE FROM "user" WHERE id=$1', [manifest.ownerId])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
function commandConfig() {
  const [command, path] = process.argv.slice(2)
  const env = process.env.LOAD_ENVIRONMENT
  if (
    !path ||
    !['local', 'staging', 'production'].includes(env ?? '') ||
    process.env.LOAD_FIXTURE_AUTHORIZATION !== `provision-synthetic-${env}`
  )
    throw new Error('Fixture authorization missing')
  const environment = env as Environment
  const origin = targetOrigin(process.env.LOAD_ORIGIN ?? '', environment)
  if (
    ![
      ['provision', 'cleanup'].includes(command ?? ''),
      Boolean(process.env.LOAD_DATABASE_URL),
      ['true', 'false'].includes(process.env.LOAD_HOSTED ?? ''),
    ].every(Boolean)
  )
    throw new Error('Invalid fixture command/settings')
  return { command, path, environment, origin }
}
async function main() {
  if (process.argv.length === 2 || process.argv[2] === '--help') {
    console.log(
      'Synthetic fixtures: provision <private-journal.json> | cleanup <private-journal.json>',
    )
    return
  }
  const { command, path, environment, origin } = commandConfig()
  const pool = new Pool({
    connectionString: process.env.LOAD_DATABASE_URL,
    max: 1,
  })
  try {
    if (command === 'provision')
      await provision(
        pool,
        makeManifest(environment, origin),
        path,
        process.env.LOAD_HOSTED === 'true',
      )
    else {
      const manifest = (await Bun.file(path).json()) as Manifest
      if (manifest.environment !== environment || manifest.origin !== origin)
        throw new Error('Cleanup target mismatch')
      await cleanup(pool, manifest)
    }
  } finally {
    await pool.end()
  }
}
if (import.meta.main)
  main().catch(() => {
    console.error(
      'Fixture command failed; preserve private journal for recovery.',
    )
    process.exitCode = 1
  })
