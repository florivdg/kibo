import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  K6_VERSION,
  validateRun,
  type Manifest,
} from '../../tests/load/helpers/config'
async function runConfig() {
  const env = process.env
  const fields = [
    [env.LOAD_MANIFEST, /^.+$/],
    [env.LOAD_COMMIT, /^[a-f0-9]{40}$/],
    [env.LOAD_IMAGE, /^[a-zA-Z0-9 ._:@/-]{1,200}$/],
    [env.LOAD_INFRASTRUCTURE, /^[a-zA-Z0-9 ._-]{1,200}$/],
  ] as const
  if (!fields.every(([value, pattern]) => pattern.test(value ?? '')))
    throw new Error('Missing safe provenance')
  const manifest = (await Bun.file(env.LOAD_MANIFEST!).json()) as Manifest
  const { LOAD_ENVIRONMENT = '', LOAD_PROFILE = '', LOAD_ORIGIN = '' } = env
  const config = validateRun(
    LOAD_ENVIRONMENT,
    LOAD_PROFILE,
    LOAD_ORIGIN,
    manifest,
  )
  if (env.LOAD_RUN_AUTHORIZATION !== `run-readonly-${config.environment}`)
    throw new Error('Run authorization missing')
  return { env, manifest, config }
}
async function launch(
  env: NodeJS.ProcessEnv,
  config: Awaited<ReturnType<typeof runConfig>>['config'],
  output: string,
  artifact: string,
) {
  // A clean environment prevents K6_OUT, HTTP debug and URL-tag overrides.
  // Never forward k6 stdout/stderr: transport failures may contain URLs.
  const child = Bun.spawn(
    ['k6', 'run', '--quiet', '--log-output=none', `${output}/public.js`],
    {
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        PATH: env.PATH!,
        HOME: output,
        LOAD_MANIFEST: resolve(env.LOAD_MANIFEST!),
        LOAD_ORIGIN: config.origin,
        LOAD_ENVIRONMENT: config.environment,
        LOAD_PROFILE: config.profile,
        LOAD_SUMMARY: `${artifact}/summary.json`,
      },
    },
  )
  // Last-resort wall-clock cap, independent of k6 scenarios/thresholds.
  const deadline = setTimeout(() => child.kill('SIGKILL'), 360_000)
  const stop = () => child.kill('SIGINT')
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const code = await child.exited
  clearTimeout(deadline)
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  console.log(
    `Load run completed with exit code ${code}. Sanitized results: load-results/`,
  )
  process.exitCode = code
}
async function checkVersion() {
  const version = Bun.spawn(['k6', 'version'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const versionText = await new Response(version.stdout).text()
  if ((await version.exited) || !versionText.startsWith(`k6 v${K6_VERSION} `))
    throw new Error('Wrong k6 version')
}
async function main() {
  if (process.argv[2] === '--help') {
    console.log(
      'Read-only load runner: set LOAD_ENVIRONMENT, LOAD_PROFILE, LOAD_ORIGIN, LOAD_MANIFEST, LOAD_RUN_AUTHORIZATION, LOAD_COMMIT, LOAD_IMAGE and LOAD_INFRASTRUCTURE. Results: ./load-results/',
    )
    return
  }
  // Clear artifacts before even validating configuration/version. Rejected
  // runs must never hand off an older run's summary.
  const artifact = resolve('load-results')
  await rm(artifact, { recursive: true, force: true })
  const { env, manifest, config } = await runConfig()
  await checkVersion()
  const output = resolve('.load-private')
  await mkdir(output, { recursive: true, mode: 0o700 })
  await mkdir(artifact, { mode: 0o700 })
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../../tests/load/public.ts')],
    target: 'browser',
    outdir: output,
    external: ['k6', 'k6/*'],
  })
  if (!build.success) throw new Error('Load bundle failed')
  await writeFile(
    `${artifact}/provenance.json`,
    JSON.stringify(
      {
        version: 1,
        k6: K6_VERSION,
        commit: env.LOAD_COMMIT,
        image: env.LOAD_IMAGE,
        infrastructure: env.LOAD_INFRASTRUCTURE,
        environment: config.environment,
        profile: config.profile,
        fixtureCounts: manifest.fixtures.map(({ shape, count }) => ({
          shape,
          count,
        })),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  await launch(env, config, output, artifact)
}
main().catch(() => {
  console.error('Load run refused or failed. Check private configuration.')
  process.exitCode = 1
})
