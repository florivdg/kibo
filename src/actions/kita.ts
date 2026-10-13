import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'

import { setPrivacyContact } from '@/lib/board/kita-link'
import {
  normalizePrivacyContact,
  PRIVACY_CONTACT_INVALID,
} from '@/lib/board/privacy-contact'
import { instanceMode } from '@/lib/instance'
import { PRIVACY_CONTACT_MAX } from '@/lib/limits'
import { memberRole } from '@/lib/organization-access'
import { OWNER_ROLE } from '@/lib/organization-roles'

// Admin: what the Kita's public pages say about the active Kita besides its
// name. The middleware verifies the session for kita.* and that the active
// Kita is one of the user's. Like renaming the Kita, only its owner changes
// it; like the other Kita settings, a Kita the hosted instance has paused
// may. Without HOSTED the action answers like one that doesn't exist.
async function ownedOrganizationId({ locals }: ActionAPIContext) {
  const { user, organizationId } = locals
  if (!user) throw new ActionError({ code: 'UNAUTHORIZED' })
  if (!instanceMode.hosted) throw new ActionError({ code: 'NOT_FOUND' })
  const role = organizationId && (await memberRole(organizationId, user.id))
  if (!organizationId || role !== OWNER_ROLE) {
    throw new ActionError({ code: 'FORBIDDEN' })
  }
  return organizationId
}

export const kita = {
  // Whom parents ask about data protection: an e-mail address or an
  // https:// link (src/lib/board/privacy-contact.ts), empty for nobody
  setPrivacyContact: defineAction({
    input: z.object({
      // Twice the limit before trimming; the limit itself is checked below
      privacyContact: z.string().max(2 * PRIVACY_CONTACT_MAX),
    }),
    handler: async (input, context) => {
      const organizationId = await ownedOrganizationId(context)
      const privacyContact = normalizePrivacyContact(input.privacyContact)
      if (privacyContact === undefined) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: PRIVACY_CONTACT_INVALID,
        })
      }
      await setPrivacyContact(organizationId, privacyContact)
      return { privacyContact }
    },
  }),
}
