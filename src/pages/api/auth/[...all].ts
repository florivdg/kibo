import type { APIRoute } from 'astro'

import { auth } from '@/lib/auth'
import { REQUEST_BODY_LIMIT } from '@/lib/limits'

// The adapter cuts every body off at the same limit (bodySizeLimit in
// astro.config.mjs), but only while it is being read — Better Auth would log
// that as a server error. A declared length above the limit is answered right
// away instead; the auth API only ever reads a few hundred bytes of JSON.

export const ALL: APIRoute = ({ request }) => {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > REQUEST_BODY_LIMIT) return new Response(null, { status: 413 })
  return auth.handler(request)
}
