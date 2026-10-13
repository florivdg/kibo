import type { APIContext } from 'astro'

import { errorMessage } from '@/lib/error-message'
import { analytics, analyticsEnabled } from '@/lib/instance'
import { clientAddressOf } from '@/lib/spam/client-ip'
import { allowAnalyticsPageview, noteClientIdentity } from '@/lib/spam/guard'
import { countSpamEvent } from '@/lib/spam/metrics'
import { trustedProxies } from '@/lib/trusted-proxies'

// The page views of the hosted start page, counted by the server: once the
// middleware has the answer to a GET of / in hand, it reports the view to
// Plausible's Events API — nothing runs in the browser, nothing is read from
// or stored on the visitor's device (§ 25 TDDDG). Only while the start page
// counts (analyticsEnabled).
//
// What goes out is what Plausible needs and nothing else: the page's address
// (with its query, which carries campaign parameters), the referrer, the
// visitor's User-Agent and address (X-Forwarded-For, resolved like the spam
// budgets do: TRUSTED_PROXIES) — no cookies, no other header. Plausible turns
// address and User-Agent into a daily hash and stores neither.

type PageviewContext = Pick<APIContext, 'request' | 'url' | 'clientAddress'>

// What became of a request: not a view to count, held back (budget, too many
// reports under way), passed on, or not taken by Plausible
type PageviewOutcome = 'skipped' | 'limited' | 'sent' | 'failed'

const MINUTE = 60_000
// Plausible answers within milliseconds; the visitor's page never waits for
// it, the report goes out after the answer
const UPSTREAM_TIMEOUT_MS = 5000
// A Plausible that doesn't answer would otherwise write a line per visit
const WARNING_INTERVAL_MS = 10 * MINUTE
// Reports under way at once in this process. Each one costs a budget check in
// Postgres, which the start page itself doesn't touch: a flood of requests
// for / must not queue up queries in front of the boards' own. Beyond this,
// a view is not counted.
export const PAGEVIEWS_IN_FLIGHT_MAX = 16

let inFlight = 0
let lastWarning = -Infinity

function warn(what: string) {
  const now = Date.now()
  if (now - lastWarning < WARNING_INTERVAL_MS) return
  lastWarning = now
  console.warn(`[analytics] ${what}`)
}

// A browser that loads the page ahead of a click (Sec-Purpose: prefetch,
// prefetch;prerender; Purpose: prefetch in older ones) hasn't shown it yet
function isPrefetch(headers: Headers) {
  return ['sec-purpose', 'purpose'].some((name) =>
    headers.get(name)?.toLowerCase().includes('prefetch'),
  )
}

// Do Not Track or Global Privacy Control: the visitor objects, and isn't
// counted
function objects(headers: Headers) {
  return (
    headers.get('dnt')?.trim() === '1' || headers.get('sec-gpc')?.trim() === '1'
  )
}

// The start page as a visitor sees it: a GET of / answered with the page
function isShownStartPage(
  { request, url }: PageviewContext,
  response: Response,
) {
  return (
    request.method === 'GET' &&
    url.pathname === '/' &&
    response.status === 200 &&
    (response.headers.get('content-type')?.startsWith('text/html') ?? false) &&
    !isPrefetch(request.headers) &&
    !objects(request.headers)
  )
}

// A referrer of this host is a page of Kibo, possibly one whose address is a
// capability (an invitation, a board): it doesn't go out. Compared by host,
// so a proxy that ends TLS doesn't let it slip through as another origin.
function outsideReferrer(header: string | null, own: URL) {
  const referrer = header ? URL.parse(header) : null
  return referrer && referrer.host !== own.host ? header : null
}

// A view to report: who the budget counts (the network), and what goes to
// Plausible
interface Visit {
  client: string
  address: string
  userAgent: string
  url: URL
  referrer: string | null
}

// The visit, or undefined when the answer is no view to count. A visit whose
// address or browser can't be told is not counted either: Plausible would
// take it for a visit of the server.
function countableVisit(
  context: PageviewContext,
  response: Response,
): Visit | undefined {
  if (!analyticsEnabled() || !isShownStartPage(context, response)) return
  const { request, url, clientAddress } = context
  const { headers } = request
  const address = clientAddressOf(
    headers.get('x-forwarded-for'),
    clientAddress,
    trustedProxies,
  )
  const userAgent = headers.get('user-agent')
  if (!address || !userAgent) return
  return {
    client: noteClientIdentity(request, clientAddress),
    address,
    userAgent,
    url,
    referrer: outsideReferrer(headers.get('referer'), url),
  }
}

async function sendPageview({
  address,
  userAgent,
  url,
  referrer,
}: Visit): Promise<PageviewOutcome> {
  const target = new URL('api/event', analytics.url).href
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': userAgent,
        'x-forwarded-for': address,
      },
      body: JSON.stringify({
        name: 'pageview',
        url: url.href,
        domain: analytics.domain,
        referrer,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    await response.body?.cancel()
    if (response.ok) return 'sent'
    warn(`${target} antwortet ${response.status}`)
  } catch (error) {
    warn(`${target} nicht erreichbar: ${errorMessage(error)}`)
  }
  return 'failed'
}

async function report(visit: Visit): Promise<PageviewOutcome> {
  if (!(await allowAnalyticsPageview(visit.client))) return 'limited'
  return sendPageview(visit)
}

// Reports the view if `response` shows the start page to a visitor. Called
// without waiting (src/middleware.ts): it never rejects, and whatever
// Plausible does, the page is already on its way.
export async function countPageview(
  context: PageviewContext,
  response: Response,
): Promise<PageviewOutcome> {
  try {
    const visit = countableVisit(context, response)
    if (!visit) return 'skipped'
    if (inFlight >= PAGEVIEWS_IN_FLIGHT_MAX) {
      countSpamEvent('analytics:limited')
      return 'limited'
    }
    inFlight++
    try {
      return await report(visit)
    } finally {
      inFlight--
    }
  } catch (error) {
    warn(`Aufruf nicht gezählt: ${errorMessage(error)}`)
    return 'failed'
  }
}
