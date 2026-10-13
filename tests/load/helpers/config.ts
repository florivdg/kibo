export const K6_VERSION = '2.3.0'
export const profiles = {
  smoke: { seconds: 120, vus: 2, rate: 0 },
  baseline: { seconds: 300, vus: 50, rate: 25 },
  production: { seconds: 300, vus: 4, rate: 1 },
} as const
export type Environment = 'local' | 'staging' | 'production'
export type Profile = keyof typeof profiles
export interface Fixture {
  id: string
  token: string
  boardId: string
  shape: 'empty' | 'typical' | 'large'
  count: number
  name: string
  cursor?: { id: string; createdAt: string }
}
export interface Manifest {
  version: 1
  runId: string
  ownerId: string
  environment: Environment
  origin: string
  expiresAt: string
  fixtures: Fixture[]
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function targetOrigin(value: string, environment: Environment) {
  // k6 does not expose WHATWG URL. Restrict to an origin grammar instead.
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?\/?$/.exec(
    value,
  )
  if (!match) throw new Error('Invalid target')
  const [, scheme, hostname, port] = match
  if (port && (Number(port) < 1 || Number(port) > 65535))
    throw new Error('Invalid port')
  const local = ['localhost', '127.0.0.1'].includes(hostname!.toLowerCase())
  if (environment === 'local' ? !local : scheme !== 'https' || local)
    throw new Error('Invalid target')
  return `${scheme}://${hostname!.toLowerCase()}${port ? `:${port}` : ''}`
}
export function validateRun(
  environment: string,
  profile: string,
  origin: string,
  manifest: Manifest,
) {
  if (
    !['local', 'staging', 'production'].includes(environment) ||
    !Object.hasOwn(profiles, profile)
  )
    throw new Error('Invalid environment/profile')
  const env = environment as Environment
  if (
    (env === 'production') !== (profile === 'production') ||
    (profile === 'baseline' && env !== 'staging')
  )
    throw new Error('Profile forbidden for environment')
  const target = targetOrigin(origin, env)
  validateManifest(manifest)
  if (
    manifest.environment !== env ||
    manifest.origin !== target ||
    !Number.isFinite(Date.parse(manifest.expiresAt)) ||
    Date.parse(manifest.expiresAt) <= Date.now()
  )
    throw new Error('Fixture target or expiry mismatch')
  return { environment: env, profile: profile as Profile, origin: target }
}
export function validateManifest(manifest: Manifest) {
  if (
    manifest.version !== 1 ||
    !uuid.test(manifest.runId) ||
    !uuid.test(manifest.ownerId) ||
    manifest.fixtures.length !== 3
  )
    throw new Error('Invalid fixtures')
  const ids = new Set<string>()
  for (const [index, fixture] of manifest.fixtures.entries()) {
    const shape = ['empty', 'typical', 'large'][index]
    const count = [0, 12, 240][index]
    if (
      !uuid.test(fixture.id) ||
      !uuid.test(fixture.boardId) ||
      ids.has(fixture.id) ||
      !/^[\w-]{22}$/.test(fixture.token) ||
      fixture.shape !== shape ||
      fixture.count !== count ||
      fixture.name !== `Kibo Lasttest ${manifest.runId} ${shape}`
    )
      throw new Error('Invalid fixture identity')
    ids.add(fixture.id)
    if (
      shape === 'large' &&
      (!fixture.cursor ||
        !uuid.test(fixture.cursor.id) ||
        !Number.isFinite(Date.parse(fixture.cursor.createdAt)))
    )
      throw new Error('Missing older-page cursor')
  }
}
