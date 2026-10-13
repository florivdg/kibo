// Response headers every answer of the app carries. The Content-Security-Policy
// of pages comes from Astro (security.csp in astro.config.mjs), which hashes
// the inline scripts and styles it renders; this module only fills in a policy
// for what Astro doesn't render — redirects, JSON, the auth API — and the
// headers CSP doesn't cover. Static files under /_astro are served before the
// middleware runs; their headers are the proxy's business
// (docs/selbst-hosten/sicherheit.md).

import { RESET_PASSWORD_PATH } from '@/lib/auth-paths'
import { isKitaPath } from '@/lib/board/paths'

// Nothing Kibo answers outside a page needs to load or run anything
const NON_PAGE_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

// `astro dev` renders pages without a policy, and a strict one would break the
// dev server's own scripts. What can't hurt there is still set.
const DEV_PAGE_CSP =
  "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// Features a notice board never asks for
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
].join(', ')

const STATIC_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
}

function startsWith(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isAdminPath(pathname: string) {
  return startsWith(pathname, '/admin')
}

// The Kita link is the key to its boards, and a reset link the key to an
// account: neither may travel on as a Referer. isKitaPath: everything below
// /k/<token>/ — the Kita page, its boards and its manifest.
function referrerPolicy(pathname: string) {
  return isKitaPath(pathname) || startsWith(pathname, RESET_PASSWORD_PATH)
    ? 'no-referrer'
    : 'strict-origin-when-cross-origin'
}

// Signed-in pages and action answers carry personal data; neither the browser
// nor anything in between keeps a copy. Boards change all the time: they are
// revalidated on every visit (no-cache still allows the back/forward cache),
// and kept out of shared caches like the link that opens them.
function cacheControl(pathname: string) {
  if (isAdminPath(pathname) || pathname.startsWith('/_actions/')) {
    return 'private, no-store'
  }
  return isKitaPath(pathname) ? 'private, no-cache' : undefined
}

// Boards are reachable by anyone with the link, which is not the same as
// wanting them in a search engine. Everything else may be found — the start
// page, and on the hosted instance the documentation under /docs, which is
// there to be read.
function isUnlisted(pathname: string) {
  return isKitaPath(pathname) || isAdminPath(pathname)
}

function contentSecurityPolicy(response: Response) {
  const type = response.headers.get('content-type') ?? ''
  return import.meta.env.DEV && type.startsWith('text/html')
    ? DEV_PAGE_CSP
    : NON_PAGE_CSP
}

// Some responses (Response.redirect(), fetched ones) have immutable headers;
// those are copied once rather than failing the request
function withMutableHeaders(response: Response) {
  try {
    response.headers.set('x-content-type-options', 'nosniff')
    return response
  } catch {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    })
  }
}

export function withSecurityHeaders(pathname: string, original: Response) {
  const response = withMutableHeaders(original)
  const { headers } = response
  for (const [name, value] of Object.entries(STATIC_HEADERS)) {
    headers.set(name, value)
  }
  headers.set('referrer-policy', referrerPolicy(pathname))
  if (!headers.has('content-security-policy')) {
    headers.set('content-security-policy', contentSecurityPolicy(response))
  }
  const caching = cacheControl(pathname)
  if (caching) headers.set('cache-control', caching)
  if (isUnlisted(pathname)) headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
