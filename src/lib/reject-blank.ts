import { hasVisibleText } from '@/lib/plain-text'

// Native `required` accepts whitespace-only input; the actions reject it (and
// text made only of invisible characters) after trimming, so flag it in the
// browser before the form is submitted
export function rejectBlank(event: Event, message: string) {
  const field = event.target as HTMLInputElement | HTMLTextAreaElement
  field.setCustomValidity(hasVisibleText(field.value) ? '' : message)
}
