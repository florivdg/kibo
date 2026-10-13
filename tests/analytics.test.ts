import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import {
  countPageview,
  PAGEVIEWS_IN_FLIGHT_MAX,
} from '@/lib/analytics/pageview'
import { analytics, instanceMode } from '@/lib/instance'
import { ANALYTICS_PAGEVIEW_BUDGETS } from '@/lib/spam/budgets'

import { resetSpamCounters } from './helpers/spam-db'

// The page-view counting of the hosted start page
// (src/lib/analytics/pageview.ts): the server reports a view of / to
// Plausible's Events API — here a Bun server standing in for it, which
// records what arrives.

const DOMAIN = 'kibo.example'
const ORIGIN = 'https://kibo.example'
const BROWSER = 'Mozilla/5.0 (Kita-Test)'

interface Received {
  method: string
  path: string
  headers: Headers
  body: string
}

const servers: ReturnType<typeof Bun.serve>[] = []

function fakePlausible(
  answer: () => Response | Promise<Response> = () =>
    new Response('ok', { status: 202 }),
) {
  const received: Received[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: await request.text(),
      })
      return answer()
    },
  })
  servers.push(server)
  analytics.url = `http://127.0.0.1:${server.port}/stats/`
  return received
}

const original = { hosted: instanceMode.hosted, ...analytics }

function counting(on = true) {
  instanceMode.hosted = on
  analytics.domain = on ? DOMAIN : ''
}

const startPage = () =>
  new Response('<!doctype html><title>Kibo</title>', {
    headers: { 'content-type': 'text/html' },
  })

interface Visit {
  path?: string
  method?: string
  headers?: Record<string, string>
  clientAddress?: string
  response?: Response
}

// A browser opening the start page from a search engine, with what must not
// travel on
function visit({
  path = '/?utm_source=elternbrief',
  method = 'GET',
  headers = {},
  clientAddress = '::1',
  response = startPage(),
}: Visit = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      'user-agent': BROWSER,
      'x-forwarded-for': '203.0.113.9',
      referer: 'https://suche.example/?q=kita+brett',
      cookie: 'better-auth.session_token=geheim',
      authorization: 'Bearer geheim',
      'accept-language': 'de-DE',
      ...headers,
    },
  })
  return countPageview(
    { request, url: new URL(request.url), clientAddress },
    response,
  )
}

const bodyOf = (received: Received) =>
  JSON.parse(received.body) as Record<string, unknown>

beforeEach(async () => {
  counting()
  await resetSpamCounters()
})

afterAll(async () => {
  instanceMode.hosted = original.hosted
  analytics.domain = original.domain
  analytics.url = original.url
  await Promise.all(servers.map((server) => server.stop(true)))
})

describe('a view of the start page', () => {
  test('goes to the Events API with the page, the browser and the address only', async () => {
    const received = fakePlausible()
    expect(await visit()).toBe('sent')

    expect(received).toHaveLength(1)
    const [event] = received
    expect(event?.method).toBe('POST')
    expect(event?.path).toBe('/stats/api/event')
    expect(bodyOf(event!)).toEqual({
      name: 'pageview',
      url: `${ORIGIN}/?utm_source=elternbrief`,
      domain: DOMAIN,
      referrer: 'https://suche.example/?q=kita+brett',
    })
    expect(event?.headers.get('content-type')).toBe('application/json')
    expect(event?.headers.get('user-agent')).toBe(BROWSER)
    expect(event?.headers.get('x-forwarded-for')).toBe('203.0.113.9')
    for (const name of [
      'cookie',
      'authorization',
      'referer',
      'accept-language',
    ]) {
      expect(event?.headers.get(name)).toBeNull()
    }
  })

  test('without a proxy, comes from the connection’s whole address', async () => {
    const received = fakePlausible()
    const request = new Request(`${ORIGIN}/`, {
      headers: { 'user-agent': BROWSER },
    })
    const outcome = await countPageview(
      {
        request,
        url: new URL(request.url),
        clientAddress: '2001:db8:abcd:1234::1',
      },
      startPage(),
    )
    expect(outcome).toBe('sent')
    expect(received[0]?.headers.get('x-forwarded-for')).toBe(
      '2001:0db8:abcd:1234:0000:0000:0000:0001',
    )
    expect(bodyOf(received[0]!).referrer).toBeNull()
  })

  // A page of Kibo as referrer may carry a capability (an invitation, a
  // board); a referrer from elsewhere is what the counting is for
  test('loses a referrer of this site, keeps one from elsewhere', async () => {
    const received = fakePlausible()
    for (const referer of [
      `${ORIGIN}/admin/invitation?id=geheim`,
      'http://kibo.example/k/abcdefghijklmnopqrstuv/',
      'kein referrer',
    ]) {
      expect(await visit({ headers: { referer } })).toBe('sent')
    }
    expect(received.map((event) => bodyOf(event).referrer)).toEqual([
      null,
      null,
      null,
    ])
  })

  test('is not counted where the answer is no start page shown', async () => {
    const received = fakePlausible()
    for (const skipped of [
      { method: 'HEAD' },
      { method: 'POST' },
      { path: '/admin/login' },
      { path: '/k/abcdefghijklmnopqrstuv/' },
      { path: '/index.html' },
      { response: new Response('weg', { status: 404 }) },
      { response: new Response(null, { status: 304 }) },
      {
        response: new Response(null, {
          status: 302,
          headers: { location: '/admin' },
        }),
      },
      {
        response: new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }),
      },
    ]) {
      expect(await visit(skipped)).toBe('skipped')
    }
    expect(received).toEqual([])
  })

  // Loaded ahead of a click, the page hasn't been seen
  test('is not counted for a prefetch or prerender', async () => {
    const received = fakePlausible()
    for (const headers of [
      { 'sec-purpose': 'prefetch' } as Record<string, string>,
      { 'sec-purpose': 'prefetch;prerender' },
      { purpose: 'prefetch' },
      { purpose: 'Prefetch' },
    ]) {
      expect(await visit({ headers })).toBe('skipped')
    }
    expect(received).toEqual([])
  })

  // How a visitor objects: the browser's own privacy signal
  test('is not counted with Do Not Track or Global Privacy Control', async () => {
    const received = fakePlausible()
    expect(await visit({ headers: { dnt: '1' } })).toBe('skipped')
    expect(await visit({ headers: { 'sec-gpc': '1' } })).toBe('skipped')
    expect(await visit({ headers: { dnt: '0' } })).toBe('sent')
    expect(received).toHaveLength(1)
  })

  // Plausible would take it for a visit of the server
  test('is not counted when address or browser can’t be told', async () => {
    const received = fakePlausible()
    expect(
      await visit({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }),
    ).toBe('skipped')
    expect(await visit({ headers: { 'user-agent': '' } })).toBe('skipped')
    expect(received).toEqual([])
  })

  test('is not counted unless the hosted instance counts', async () => {
    const received = fakePlausible()
    for (const setUp of [
      () => counting(false),
      () => {
        instanceMode.hosted = true
        analytics.domain = ''
      },
      () => {
        instanceMode.hosted = false
        analytics.domain = DOMAIN
      },
    ]) {
      setUp()
      expect(await visit()).toBe('skipped')
    }
    expect(received).toEqual([])
  })

  test('fails quietly when Plausible turns it away or isn’t there', async () => {
    fakePlausible(() => new Response('nein', { status: 400 }))
    expect(await visit()).toBe('failed')
    analytics.url = 'http://127.0.0.1:9/'
    expect(await visit()).toBe('failed')
  })

  // A redirect from Plausible is not followed with the visitor's data
  test('follows no redirect', async () => {
    const received = fakePlausible(
      () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://anderswo.example/api/event' },
        }),
    )
    expect(await visit()).toBe('failed')
    expect(received).toHaveLength(1)
  })
})

describe('the budget', () => {
  const max = ANALYTICS_PAGEVIEW_BUDGETS[0]!.max

  test('passes a network’s views on up to its budget', async () => {
    const received = fakePlausible()
    const from = { 'x-forwarded-for': '198.51.100.23' }
    for (let i = 0; i < max; i++) {
      expect(await visit({ headers: from })).toBe('sent')
    }
    expect(await visit({ headers: from })).toBe('limited')
    expect(received).toHaveLength(max)
    // Another network is counted on its own
    expect(
      await visit({ headers: { 'x-forwarded-for': '198.51.100.24' } }),
    ).toBe('sent')
  })

  // A flood of requests for / must not queue up budget checks and reports
  test('holds back views beyond the reports under way at once', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    fakePlausible(() => gate.then(() => new Response('ok', { status: 202 })))
    const pending = Array.from({ length: PAGEVIEWS_IN_FLIGHT_MAX }, (_, i) =>
      visit({ headers: { 'x-forwarded-for': `198.51.100.${i + 1}` } }),
    )
    expect(await visit({ headers: { 'x-forwarded-for': '192.0.2.1' } })).toBe(
      'limited',
    )
    open()
    expect(await Promise.all(pending)).toEqual(
      pending.map(() => 'sent' as const),
    )
    // Once they are through, the next one goes out again
    expect(await visit({ headers: { 'x-forwarded-for': '192.0.2.1' } })).toBe(
      'sent',
    )
  })
})
