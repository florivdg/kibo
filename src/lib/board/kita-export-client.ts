// The browser's half of the Kita's data export: fetches the file from
// src/pages/admin/kita/export.ts and hands it to the browser as a download,
// or says why there is none. Fetched rather than linked, so a refusal shows
// up as a toast on the page instead of a bare text page or a broken download.

const KITA_EXPORT_PATH = '/admin/kita/export'

const FALLBACK_FILENAME = 'kibo-export.json'

const SIGNED_OUT =
  'Sie sind nicht mehr angemeldet. Bitte laden Sie die Seite neu und melden Sie sich an.'
const FAILED =
  'Der Download hat nicht geklappt. Bitte versuchen Sie es noch einmal.'

// The name the server gave the file (always a plain quoted ASCII name)
export function attachmentFilename(disposition: string | null) {
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? FALLBACK_FILENAME
}

// Why a response is no download: the server's own sentence where it sent one
export async function exportRefusal(response: Response) {
  // Without a session the middleware redirects to the login
  if (response.type === 'opaqueredirect') return SIGNED_OUT
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('text/plain')) return FAILED
  return (await response.text()) || FAILED
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Firefox and Safari start the download only after the click returns;
  // revoking the URL at once can abort it, so it is kept for a minute
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Null once the browser has the file, otherwise what to tell the admin
export async function downloadKitaExport(): Promise<string | null> {
  try {
    const response = await fetch(KITA_EXPORT_PATH, { redirect: 'manual' })
    if (!response.ok) return await exportRefusal(response)
    const filename = attachmentFilename(
      response.headers.get('content-disposition'),
    )
    saveFile(await response.blob(), filename)
    return null
  } catch {
    return FAILED
  }
}
