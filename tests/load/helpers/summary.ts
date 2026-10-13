import type { Profile } from './config'
// Only these aggregate numbers may leave the private runner. Never serialize
// k6's groups, tags, setup_data, errors, request URLs or fixture manifest.
const allowed = [
  'page_success_ms',
  'kita_success_ms',
  'board_success_ms',
  'list_success_ms',
  'unexpected',
  'expected_429',
  'health_failures',
  'dropped_iterations',
  'iterations',
  'http_reqs',
  ...[1, 5, 10, 25].flatMap((rate) => [
    `pages${rate}_count`,
    `pages${rate}_success_ms`,
    `pages${rate}_errors`,
    `dropped_iterations{scenario:pages${rate}}`,
  ]),
]
export function sanitizedMetrics(data: {
  metrics: Record<string, { values: Record<string, number> }>
}) {
  const result: Record<string, Record<string, number>> = {}
  for (const name of allowed) {
    const values = data.metrics[name]?.values
    if (!values) continue
    result[name] = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          [
            'count',
            'rate',
            'avg',
            'min',
            'max',
            'med',
            'p(90)',
            'p(95)',
            'p(99)',
          ].includes(key) && Number.isFinite(value),
      ),
    )
  }
  return result
}

export function sanitizedStages(
  data: {
    metrics: Record<string, { values: Record<string, number> }>
    state?: { testRunDurationMs?: number }
  },
  profile: Profile,
) {
  const metrics = sanitizedMetrics(data)
  const rates = profile === 'baseline' ? [5, 10, 25] : [1]
  const valueOf = (name: string) => metrics[name] ?? {}
  const elapsed = (data.state?.testRunDurationMs ?? 0) / 1000
  if (profile === 'smoke') return []
  return rates.map((requestedRate, index) => {
    const stage = `pages${requestedRate}`
    const configuredSeconds = profile === 'baseline' ? 100 : 300
    const measuredSeconds = Math.min(
      configuredSeconds,
      Math.max(0, elapsed - index * configuredSeconds),
    )
    const completedRequests = valueOf(`${stage}_count`).count ?? 0
    return {
      stage,
      requestedRate,
      configuredSeconds,
      measuredSeconds,
      completedRequests,
      achievedRate:
        measuredSeconds > 0 ? completedRequests / measuredSeconds : 0,
      latency: valueOf(`${stage}_success_ms`),
      errors: valueOf(`${stage}_errors`),
      droppedIterations:
        valueOf(`dropped_iterations{scenario:${stage}}`).count ?? 0,
    }
  })
}
