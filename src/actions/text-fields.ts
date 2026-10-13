import { z } from 'astro/zod'

import { hasVisibleText, isPlainText } from '@/lib/plain-text'

interface TextFieldOptions {
  // Keeps line breaks and tabs
  multiline?: boolean
}

// Text a person typed: trimmed, bounded, free of control characters, and with
// something visible in it — whitespace or a string of zero-width characters
// is as empty as nothing at all
export function requiredText(max: number, options: TextFieldOptions = {}) {
  return z
    .string()
    .trim()
    .refine((value) => isPlainText(value, max, options))
}

// Like requiredText, but may be left empty. Invisible-only input is stored as
// the empty string it looks like.
export function optionalText(max: number, options: TextFieldOptions = {}) {
  return z
    .string()
    .trim()
    .refine((value) =>
      isPlainText(value, max, { ...options, allowBlank: true }),
    )
    .transform((value) => (hasVisibleText(value) ? value : ''))
}
