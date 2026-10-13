import { DATABASE_URL } from 'astro:env/server'
import { validPage } from './load/helpers/page'
import { expect, test } from 'bun:test'
import { stringify } from 'devalue'
import { makeManifest, cleanup, provision } from '../scripts/load/fixtures'
import { validateRun } from './load/helpers/config'
import { validOlderPage, listInput } from './load/helpers/wire'
import { sanitizedStages, sanitizedMetrics } from './load/helpers/summary'
import { Pool } from 'pg'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
function fixtureManifest() {
  const manifest = makeManifest('local', 'http://localhost:4321')
  manifest.fixtures[2]!.cursor = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  return manifest
}
test('target, environment and profile guards reject unsafe configurations', () => {
  const manifest = fixtureManifest()
  expect(() =>
    validateRun('local', 'smoke', 'http://localhost:4321', manifest),
  ).not.toThrow()
  for (const [env, profile, origin] of [
    ['production', 'baseline', 'https://example.org'],
    ['staging', 'unknown', 'https://example.org'],
    ['local', 'smoke', 'http://evil.test'],
    ['local', 'smoke', 'http://localhost:4321/k/secret/'],
    ['local', 'smoke', 'http://user:pass@localhost:4321'],
  ])
    expect(() => validateRun(env!, profile!, origin!, manifest)).toThrow()
  manifest.expiresAt = 'invalid'
  expect(() =>
    validateRun('local', 'smoke', 'http://localhost:4321', manifest),
  ).toThrow()
})
test('Astro JSON request and devalue response validate older notes', () => {
  const fixture = fixtureManifest().fixtures[2]!
  expect(JSON.parse(listInput(fixture))).toEqual({
    kitaToken: fixture.token,
    boardId: fixture.boardId,
    cursor: fixture.cursor,
  })
  const notes = Array.from({ length: 40 }, (_, index) => ({
    id: crypto.randomUUID(),
    title: `Synthetischer Zettel ${40 + index}`,
    createdAt: new Date(
      Date.parse(fixture.cursor!.createdAt) - (index + 1) * 1000,
    ).toISOString(),
  }))
  expect(validOlderPage(stringify({ notes, hasMore: true }), fixture)).toBe(
    true,
  )
  expect(
    validOlderPage(JSON.stringify({ notes, hasMore: true }), fixture),
  ).toBe(false)
  expect(
    validOlderPage(
      stringify({ notes: notes.slice(1), hasMore: true }),
      fixture,
    ),
  ).toBe(false)
})
test('artifact allowlist excludes URLs, tokens, cookies and tagged metrics', () => {
  const secret = 'private-capability'
  const data = {
    metrics: {
      page_success_ms: { values: { 'p(99)': 123, avg: 42 } },
      [secret]: { values: { count: 99 } },
      [`page_success_ms{url:${secret}}`]: { values: { avg: 1 } },
    },
    setup_data: { token: secret },
    groups: { cookies: secret },
  }
  const artifact = JSON.stringify(sanitizedMetrics(data))
  expect(artifact).not.toContain(secret)
  expect(artifact).toContain('p(99)')
})
test('fixtures journal, synthetic identities and cleanup boundaries', async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 })
  const directory = await mkdtemp(join(tmpdir(), 'kibo-load-'))
  const manifest = makeManifest('local', 'http://localhost:4321')
  const path = join(directory, 'manifest.json')
  try {
    await provision(pool, manifest, path, true)
    expect(await Bun.file(path).json()).toEqual(manifest)
    const interrupted = makeManifest('local', 'http://localhost:4321')
    let refused = false
    try {
      await provision(pool, interrupted, path, true)
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
    expect(
      (
        await pool.query('SELECT id FROM organization WHERE id=$1', [
          interrupted.fixtures[0]!.id,
        ])
      ).rowCount,
    ).toBe(0)
    const fixture = manifest.fixtures[0]!
    await pool.query(
      "UPDATE organization SET metadata='customer' WHERE id=$1",
      [fixture.id],
    )
    expect(cleanup(pool, manifest)).rejects.toThrow('Cleanup identity mismatch')
    expect(
      (
        await pool.query('SELECT id FROM organization WHERE id=$1', [
          fixture.id,
        ])
      ).rowCount,
    ).toBe(1)
    await pool.query('UPDATE organization SET metadata=$1 WHERE id=$2', [
      JSON.stringify({ kiboLoadTest: manifest.runId }),
      fixture.id,
    ])
    await cleanup(pool, manifest)
    await cleanup(pool, manifest)
    expect(
      (
        await pool.query('SELECT id FROM "user" WHERE id=$1', [
          manifest.ownerId,
        ])
      ).rowCount,
    ).toBe(0)
  } finally {
    if (await Bun.file(path).exists()) await cleanup(pool, manifest)
    await pool.end()
    await rm(directory, { recursive: true, force: true })
  }
})

test('page content validates all fixture shapes and rejects paused or names-only pages', () => {
  for (const fixture of fixtureManifest().fixtures) {
    const names = `<h1>${fixture.name}</h1><h2>Synthetisches Brett</h2>`
    const page = (body: string) => ({
      status: 200,
      contentType: 'text/html',
      body,
    })
    const notes =
      fixture.count === 0
        ? '<p>Das Brett ist noch leer.</p>'
        : Array.from(
            { length: Math.min(40, fixture.count) },
            (_, i) => `<h2><button>Synthetischer Zettel ${i}</button></h2>`,
          ).join('')
    expect(validPage(page(names + notes), fixture, true)).toBe(true)
    expect(
      validPage(
        page(
          names +
            'Alle Bretter eurer Kita.' +
            (fixture.count === 0
              ? 'Noch keine Zettel'
              : `${fixture.count} Zettel`),
        ),
        fixture,
        false,
      ),
    ).toBe(true)
    expect(validPage(page(names), fixture, true)).toBe(false)
    expect(
      validPage(
        page(names + 'Die Bretter dieser Kita sind gerade pausiert.'),
        fixture,
        true,
      ),
    ).toBe(false)
    expect(
      validPage(
        page(
          names +
            `<astro-island props="${notes.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}"></astro-island>`,
        ),
        fixture,
        true,
      ),
    ).toBe(false)
    expect(validPage(page(names), fixture, false)).toBe(false)
  }
})
test('stage evidence uses fixed labels and stage duration for achieved rates', () => {
  const data = {
    state: { testRunDurationMs: 300000 },
    metrics: {
      pages5_count: { values: { count: 500 } },
      pages5_success_ms: { values: { 'p(95)': 40 } },
      pages5_errors: { values: { rate: 0 } },
      'dropped_iterations{scenario:pages5}': { values: { count: 2 } },
      'pages5_count{url:private-capability}': { values: { count: 999999 } },
    },
  }
  const stages = sanitizedStages(data, 'baseline')
  expect(stages[0]).toMatchObject({
    stage: 'pages5',
    requestedRate: 5,
    measuredSeconds: 100,
    completedRequests: 500,
    achievedRate: 5,
    droppedIterations: 2,
  })
  expect(JSON.stringify(stages)).not.toContain('private-capability')
  expect(sanitizedStages(data, 'smoke')).toEqual([])
})
test('refused run removes stale artifacts before configuration validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kibo-load-refusal-'))
  try {
    await mkdir(join(directory, 'load-results'))
    await writeFile(join(directory, 'load-results', 'summary.json'), 'stale')
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, '../scripts/load/run.ts')],
      {
        cwd: directory,
        env: { PATH: process.env.PATH!, LOAD_PROFILE: 'invalid' },
        stdout: 'ignore',
        stderr: 'ignore',
      },
    )
    expect(await child.exited).toBe(1)
    expect(
      await Bun.file(join(directory, 'load-results', 'summary.json')).exists(),
    ).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('standalone fixture bundle defaults to help without database access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kibo-load-bundle-'))
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, '../scripts/load/fixtures.ts')],
      target: 'bun',
      outdir: directory,
    })
    expect(build.success).toBe(true)
    const artifact = build.outputs[0]!.path
    for (const args of [[], ['--help']]) {
      const child = Bun.spawn([process.execPath, artifact, ...args], {
        cwd: directory,
        env: {
          PATH: process.env.PATH!,
          LOAD_DATABASE_URL:
            'postgresql://invalid:invalid@127.0.0.1:1/unreachable',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(await child.exited).toBe(0)
      expect(await new Response(child.stdout).text()).toContain(
        'Synthetic fixtures: provision',
      )
      expect(await new Response(child.stderr).text()).toBe('')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('standalone runner help preserves artifacts without configuration or network tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kibo-load-runner-help-'))
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, '../scripts/load/run.ts')],
      target: 'bun',
      outdir: directory,
    })
    expect(build.success).toBe(true)
    await mkdir(join(directory, 'load-results'))
    const summary = join(directory, 'load-results', 'summary.json')
    await writeFile(summary, 'previous-result')
    const child = Bun.spawn(
      [process.execPath, build.outputs[0]!.path, '--help'],
      {
        cwd: directory,
        env: { PATH: '/no-network-tools', LOAD_PROFILE: 'invalid' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toContain(
      'Read-only load runner:',
    )
    expect(await new Response(child.stderr).text()).toBe('')
    expect(await Bun.file(summary).text()).toBe('previous-result')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
