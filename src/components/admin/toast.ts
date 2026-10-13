import { toast } from 'vue-sonner'

import { copyText } from '@/lib/clipboard'

// An error stays until it is closed: there is no telling how long somebody
// needs to read it (WCAG 2.2.1). Successes go away by themselves.
export function toastError(message: string) {
  toast.error(message, { duration: Infinity, closeButton: true })
}

// Copies text and says in a toast whether that worked
export async function copyWithToast(
  text: string,
  messages: { done: string; failed: string },
) {
  if (await copyText(text)) toast.success(messages.done)
  else toastError(messages.failed)
}
