import { APIError } from 'better-auth/api'

// Relative imports: auth-options.ts (and with it this file) is also loaded by
// the schema generator, outside of Astro's @/ alias
import { ORGANIZATION_NAME_MAX } from './limits'
import { isOrganizationSlug } from './organization-slug'
import { isPlainText, looksLikeLink } from './plain-text'

interface OrganizationInput {
  name?: unknown
  slug?: unknown
  logo?: unknown
  metadata?: unknown
  [key: string]: unknown
}

function invalid(code: string, message: string) {
  return APIError.fromStatus('BAD_REQUEST', { code, message })
}

// Trimmed, 1–100 characters, something visible and nothing that controls how
// the text is displayed. The name ends up on every board and in the admin area.
// And in the invitation mail, which goes to an address of the owner's
// choosing: a name that reads like a link would put that link into a mail
// from Kibo to a stranger.
function organizationName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!isPlainText(name, ORGANIZATION_NAME_MAX)) {
    throw invalid('INVALID_ORGANIZATION_NAME', 'Invalid organization name')
  }
  if (looksLikeLink(name)) {
    throw invalid(
      'ORGANIZATION_NAME_LOOKS_LIKE_LINK',
      'Organization name looks like a link',
    )
  }
  return name
}

function assertSlug(value: unknown) {
  if (!isOrganizationSlug(value)) {
    throw invalid('INVALID_ORGANIZATION_SLUG', 'Invalid organization slug')
  }
}

// Kibo has no logo and keeps nothing in metadata. Both would be free-form
// fields stored for anyone to fill in, so they stay empty.
function assertNoExtras({ logo, metadata }: OrganizationInput) {
  if (logo != null || metadata !== undefined) {
    throw invalid('INVALID_ORGANIZATION', 'Unsupported organization fields')
  }
}

// Better Auth checks neither the name nor the slug beyond "not empty"
export async function beforeCreateOrganization({
  organization,
}: {
  organization: OrganizationInput
}) {
  assertNoExtras(organization)
  assertSlug(organization.slug)
  // Merged over the request by Better Auth, so only what changes
  return { data: { name: organizationName(organization.name) } }
}

// Renaming sends only what changes, so only what is sent is checked
export async function beforeUpdateOrganization({
  organization,
}: {
  organization: OrganizationInput
}) {
  assertNoExtras(organization)
  if (organization.slug !== undefined) assertSlug(organization.slug)
  if (organization.name === undefined) return
  return { data: { name: organizationName(organization.name) } }
}
