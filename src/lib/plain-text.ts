import {
  FORBIDDEN_SINGLE_LINE,
  LOOKS_LIKE_LINK,
  VISIBLE,
} from '../../scripts/instance-config.mjs'

// What counts as acceptable text in names, titles and notes. Shared by the
// actions, the Better Auth hooks and the browser-side form checks, so all
// three agree on what is "empty" and what is not allowed at all. The patterns
// are defined in scripts/instance-config.mjs, which holds the operator's
// price note to the same ones and can't import from src/: what may not be in
// a line (FORBIDDEN_SINGLE_LINE), what a reader can see (VISIBLE) and what
// looks like an address (LOOKS_LIKE_LINK).

// Multi-line fields keep line breaks and tabs. The same pattern with those
// three let through, tested on the text as it is: taking them out first would
// join what stands on either side, two lone surrogates into a pair included.
const FORBIDDEN_MULTI_LINE = new RegExp(
  String.raw`(?![\n\r\t])` + FORBIDDEN_SINGLE_LINE.source,
  'u',
)

function hasForbiddenCharacters(value: string, multiline: boolean) {
  return (multiline ? FORBIDDEN_MULTI_LINE : FORBIDDEN_SINGLE_LINE).test(value)
}

export function hasVisibleText(value: string) {
  return VISIBLE.test(value)
}

export function looksLikeLink(value: string) {
  return LOOKS_LIKE_LINK.test(value)
}

interface PlainTextOptions {
  // Keeps line breaks and tabs
  multiline?: boolean
  // Accepts text with nothing visible in it; the caller decides what that
  // stands for
  allowBlank?: boolean
}

// Text a person typed, already trimmed: something visible in it, at most
// `max` characters, and none of the characters above
export function isPlainText(
  value: string,
  max: number,
  { multiline = false, allowBlank = false }: PlainTextOptions = {},
) {
  return (
    (allowBlank || hasVisibleText(value)) &&
    value.length <= max &&
    !hasForbiddenCharacters(value, multiline)
  )
}
