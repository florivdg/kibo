// Where the public pages of a Kita live. No imports, so the browser bundles
// can build the same addresses as the server.
//
// Every address ends with a slash: the web app manifest's scope is matched
// as a path prefix, and /k/<token> would not lie within /k/<token>/.

// Every Kita lives under it: the service worker's scope, one registration
// for all of them (public/sw.js)
export const KITA_SCOPE = '/k/'

// The Kita page, which lists every board; also the installed app's start
export function kitaPath(kitaToken: string) {
  return `${KITA_SCOPE}${kitaToken}/`
}

// One board inside the Kita. The board id is no secret: the Kita token is.
export function kitaBoardPath(kitaToken: string, boardId: string) {
  return `${kitaPath(kitaToken)}${boardId}/`
}

export function kitaManifestPath(kitaToken: string) {
  return `${kitaPath(kitaToken)}manifest.webmanifest`
}

// Where an address under /k/ without the trailing slash belongs: the same
// with it, query kept (the middleware redirects there). Null for one that has
// it, and for a file like the manifest.
export function withKitaSlash({ pathname, search }: URL) {
  if (!pathname.startsWith(KITA_SCOPE) || pathname.endsWith('/')) return null
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.includes('.') ? null : `${pathname}/${search}`
}

// Every address of a Kita link: the Kita page, its boards and its manifest.
// They share their headers (src/lib/server/security-headers.ts) and, leading
// nowhere, one 404 page (src/pages/404.astro).
export function isKitaPath(pathname: string) {
  return pathname === '/k' || pathname.startsWith(KITA_SCOPE)
}
