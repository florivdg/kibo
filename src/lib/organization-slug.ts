const BASE_MAX = 40
const SUFFIX_LENGTH = 6

// A name as lowercase words of [a-z0-9] joined by hyphens, umlauts spelled
// out; empty when nothing of it is left. Also names the file of a Kita's data
// export (src/lib/board/kita-export.ts).
export function slugBase(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, BASE_MAX)
    .replace(/^-+|-+$/g, '')
}

// Slugs must be unique, so a random suffix avoids collisions between Kitas
// with the same name
export function organizationSlug(name: string): string {
  const base = slugBase(name)
  const suffix = crypto.randomUUID().slice(0, SUFFIX_LENGTH)
  return base ? `${base}-${suffix}` : suffix
}

// Exactly the shape organizationSlug produces: lowercase words of [a-z0-9]
// joined by single hyphens, no longer than base, hyphen and suffix
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ORGANIZATION_SLUG_MAX = BASE_MAX + 1 + SUFFIX_LENGTH

export function isOrganizationSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= ORGANIZATION_SLUG_MAX &&
    SLUG_PATTERN.test(value)
  )
}
