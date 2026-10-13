// Copies text and says whether that worked. The Clipboard API needs a secure
// context; elsewhere the old execCommand route is tried, which reports
// failure instead of throwing.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  try {
    // Deprecated, but the only fallback there is
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

// Offers text as a file download, e.g. backup codes to keep
export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
