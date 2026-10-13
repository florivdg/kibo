import type { APIRoute } from 'astro'

import { kitaExport, kitaExportFilename } from '@/lib/board/kita-export'
import { isMember } from '@/lib/organization-access'
import { allowKitaExport } from '@/lib/spam/guard'

export const prerender = false

// The answer when there is nothing to download, which the button shows
const KITA_EXPORT_UNAVAILABLE =
  'Die Daten dieser Kita lassen sich nicht herunterladen. Bitte laden Sie die Seite neu.'

function refusal(status: number, message: string, retryAfterMs?: number) {
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' })
  if (retryAfterMs !== undefined) {
    headers.set('retry-after', String(Math.ceil(retryAfterMs / 1000)))
  }
  return new Response(message, { status, headers })
}

// The data of the active Kita as one JSON file (src/lib/board/kita-export.ts),
// for its owner and its admins alike. Under /admin, so the middleware has
// verified the session and the membership of the active Kita; the membership
// is asked once more here, right before reading. Never asks whether the
// hosted instance has paused the Kita: taking the data along is what a Kita
// whose subscription ran out needs most. A browser that says the request
// comes from another site (Sec-Fetch-Site) is turned away before anything is
// counted, so a foreign page can't spend a member's budget; without the
// header (older browsers) the request goes on.
export const GET: APIRoute = async ({ locals, request }) => {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') {
    return refusal(403, KITA_EXPORT_UNAVAILABLE)
  }
  const { user, organizationId } = locals
  if (!user || !organizationId || !(await isMember(organizationId, user.id))) {
    return refusal(404, KITA_EXPORT_UNAVAILABLE)
  }
  const now = new Date()
  const verdict = await allowKitaExport(user.id, organizationId, now)
  if (!verdict.allowed) {
    const { message = KITA_EXPORT_UNAVAILABLE, retryAfterMs } = verdict
    return refusal(
      retryAfterMs === undefined ? 503 : 429,
      message,
      retryAfterMs,
    )
  }
  const document = await kitaExport(organizationId, now)
  if (!document) return refusal(404, KITA_EXPORT_UNAVAILABLE)
  const filename = kitaExportFilename(document.kita.name, now)
  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
