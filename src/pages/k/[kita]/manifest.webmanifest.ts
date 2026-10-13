import type { APIRoute } from 'astro'

import { kitaManifest } from '@/lib/board/manifest'
import { findKita } from '@/lib/board/queries'

// The web app manifest of one Kita, linked from every page under its link.
// Caching, indexing and referrer headers for /k come from the middleware
// (src/lib/server/security-headers.ts), like for the pages. A Kita the
// hosted instance has paused has none, like a link that leads nowhere: its
// pages link to no manifest, and there is nothing to install.
export const GET: APIRoute = async ({ params }) => {
  const kitaToken = params.kita ?? ''
  const found = await findKita(kitaToken)
  if (!found || found.paused) return new Response(null, { status: 404 })
  return new Response(JSON.stringify(kitaManifest(kitaToken, found.name)), {
    headers: { 'content-type': 'application/manifest+json' },
  })
}
