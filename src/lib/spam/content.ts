// The text of two notes counts as the same when only spacing, case,
// punctuation, accents or Unicode spelling differ — the cheap variations a
// script uses to slip past an exact comparison. Invisible characters (zero
// width spaces, joiners, soft hyphens, combining marks, controls) are dropped
// entirely, so sprinkling them in changes nothing either.
function normalizePart(part: string) {
  return part
    .normalize('NFKD')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cf}\p{M}\p{Cc}]+/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Title and body are compared as a pair, joined by a character that can't
// survive in either part, so text moving across the border between them is a
// different note. Empty when nothing is left of any part: such a note has
// nothing to compare, and two of them are not duplicates of each other.
export function normalizeContent(parts: string[]) {
  const normalized = parts.map(normalizePart)
  return normalized.some(Boolean) ? normalized.join('|') : ''
}
