import http from 'k6/http'
import { sleep } from 'k6'
import execution from 'k6/execution'
import { Counter, Rate, Trend } from 'k6/metrics'
import type { Options } from 'k6/options'
import { profiles, validateRun, type Manifest } from './helpers/config'
import { listInput, validOlderPage } from './helpers/wire'
import { validPage } from './helpers/page'
import { sanitizedStages, sanitizedMetrics } from './helpers/summary'
const manifest = JSON.parse(open(__ENV.LOAD_MANIFEST!)) as Manifest
const config = validateRun(
  __ENV.LOAD_ENVIRONMENT!,
  __ENV.LOAD_PROFILE!,
  __ENV.LOAD_ORIGIN!,
  manifest,
)
const profile = profiles[config.profile]
const unexpected = new Rate('unexpected')
const refusals = new Counter('expected_429')
const healthFailures = new Rate('health_failures')
const pageLatency = new Trend('page_success_ms', true)
const pageKinds = [
  new Trend('kita_success_ms', true),
  new Trend('board_success_ms', true),
]
const listLatency = new Trend('list_success_ms', true)
const stageMetrics = Object.fromEntries(
  [1, 5, 10, 25].map((rate) => [
    `pages${rate}`,
    {
      count: new Counter(`pages${rate}_count`),
      latency: new Trend(`pages${rate}_success_ms`, true),
      errors: new Rate(`pages${rate}_errors`),
    },
  ]),
)
function recordStage(valid: boolean, duration: number) {
  const stage = stageMetrics[execution.scenario.name]
  if (!stage) return
  stage.count.add(1)
  stage.errors.add(!valid)
  if (valid) stage.latency.add(duration)
}
export const options: Options = {
  // URL/error tags can disclose capability links even with named requests.
  systemTags: ['method', 'status', 'name', 'scenario'],
  discardResponseBodies: false,
  maxRedirects: 0,
  summaryTrendStats: ['avg', 'min', 'max', 'med', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    unexpected: [
      'rate<0.005',
      { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '20s' },
    ],
    health_failures: [{ threshold: 'rate==0', abortOnFail: true }],
    page_success_ms: [
      'p(95)<500',
      'p(99)<1000',
      { threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' },
    ],
    list_success_ms: [
      'p(95)<300',
      { threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' },
    ],
    kita_success_ms: ['p(95)<500', 'p(99)<1000'],
    board_success_ms: ['p(95)<500', 'p(99)<1000'],
    dropped_iterations: ['count==0'],
    ...Object.fromEntries(
      (config.profile === 'baseline' ? [5, 10, 25] : [1]).map((rate) => [
        `dropped_iterations{scenario:pages${rate}}`,
        ['count==0'],
      ]),
    ),
  },
  scenarios: {
    ...(config.profile === 'smoke'
      ? {
          pages: {
            executor: 'constant-vus' as const,
            vus: 2,
            duration: '120s',
            exec: 'pages',
            gracefulStop: '0s',
          },
        }
      : Object.fromEntries(
          (config.profile === 'baseline' ? [5, 10, 25] : [1]).map(
            (rate, index) => [
              `pages${rate}`,
              {
                executor: 'constant-arrival-rate' as const,
                rate,
                timeUnit: '1s',
                preAllocatedVUs: profile.vus,
                maxVUs: profile.vus,
                duration: config.profile === 'baseline' ? '100s' : '300s',
                startTime: `${index * 100}s`,
                exec: 'pages',
                gracefulStop: '0s',
              },
            ],
          ),
        )),
    health: {
      executor: 'constant-vus',
      vus: 1,
      duration: `${profile.seconds}s`,
      exec: 'health',
      gracefulStop: '0s',
    },
    ...(config.profile === 'production'
      ? {}
      : {
          older: {
            executor: 'constant-vus' as const,
            vus: 1,
            duration: `${profile.seconds}s`,
            exec: 'older',
            gracefulStop: '0s',
          },
        }),
  },
}
const params = (name: string) => ({
  tags: { name },
  timeout: '5s',
  redirects: 0,
  cookies: {},
})
function pageUrl(fixture: Manifest['fixtures'][number], board: boolean) {
  return `${config.origin}/k/${fixture.token}/${board ? `${fixture.boardId}/` : ''}`
}
export function pages() {
  const iteration = execution.scenario.iterationInTest
  const fixture = manifest.fixtures[iteration % 3]!
  const board = iteration % 10 >= 3
  const response = http.get(
    pageUrl(fixture, board),
    params(board ? 'board-page' : 'kita-page'),
  )
  const valid = validPage(
    {
      status: response.status,
      contentType: String(response.headers['Content-Type']),
      body: response.body,
    },
    fixture,
    board,
  )
  recordStage(valid, response.timings.duration)
  unexpected.add(!valid)
  if (valid) {
    pageLatency.add(response.timings.duration)
    pageKinds[Number(board)]!.add(response.timings.duration)
  }
  sleep(config.profile === 'smoke' ? 2 : 0)
}
function validList(
  response: ReturnType<typeof http.post>,
  fixture: Manifest['fixtures'][number],
) {
  return (
    response.status === 200 &&
    String(response.headers['Content-Type']).includes(
      'application/json+devalue',
    ) &&
    typeof response.body === 'string' &&
    validOlderPage(response.body, fixture)
  )
}
export function older() {
  const fixture = manifest.fixtures[2]!
  const response = http.post(
    `${config.origin}/_actions/notes.list`,
    listInput(fixture),
    {
      ...params('notes-list-older'),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    },
  )
  const refused = response.status === 429
  if (refused) refusals.add(1)
  const valid = validList(response, fixture)
  unexpected.add(!refused && !valid)
  if (valid) listLatency.add(response.timings.duration)
  // One VU for the whole generator, <=30/5min, vs 120/15min network budget.
  sleep(10)
}
export function health() {
  const response = http.get(`${config.origin}/api/health`, params('health'))
  const failed = response.status !== 200
  healthFailures.add(failed)
  if (failed) execution.test.abort('Health check failed')
  sleep(10)
}
export function handleSummary(data: Parameters<typeof sanitizedMetrics>[0]) {
  return {
    [__ENV.LOAD_SUMMARY!]: JSON.stringify(
      {
        version: 1,
        profile: config.profile,
        environment: config.environment,
        metrics: sanitizedMetrics(data),
        stages: sanitizedStages(data, config.profile),
      },
      null,
      2,
    ),
  }
}
