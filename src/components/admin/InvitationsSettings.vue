<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAdminAction } from '@/composables/use-admin-action'
import { useFormSubmit, type SubmitError } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { INVITATION_LIMIT, INVITATION_TTL_DAYS } from '@/lib/limits'
import { ADMIN_ROLE } from '@/lib/organization-roles'

// Only the owner of a Kita gets to see this card. `expires` is the last day
// of an invitation, already formatted by the page.
const props = defineProps<{
  organizationId: string
  invitations: { id: string; email: string; expires: string }[]
}>()

// The sign-up words the domain list for the person typing their own address;
// here it is the owner typing somebody else's
function inviteErrorMessage(failure: SubmitError) {
  return failure.code === 'EMAIL_DOMAIN_NOT_ALLOWED'
    ? 'Auf dieser Instanz sind nur E-Mail-Adressen bestimmter Domains zugelassen; diese Adresse gehört nicht dazu.'
    : authErrorMessage(failure)
}

const email = ref('')
const { error, pending, run } = useFormSubmit(inviteErrorMessage)
const { pending: cancelling, run: runCancel } = useAdminAction()

// Inviting an address again withdraws its earlier invitation and sends a new
// link. Invited people always become admins; the server insists on it.
async function invite() {
  const address = email.value.trim()
  await run(
    () =>
      authClient.organization.inviteMember({
        email: address,
        role: ADMIN_ROLE,
        organizationId: props.organizationId,
      }),
    { leave: { reload: true, toast: `${address} wurde eingeladen.` } },
  )
}

async function cancel(invitation: { id: string; email: string }) {
  await runCancel(
    () =>
      authClient.organization.cancelInvitation({
        invitationId: invitation.id,
      }),
    {
      leave: {
        reload: true,
        toast: `Die Einladung an ${invitation.email} wurde zurückgezogen.`,
      },
    },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Einladen</CardHeading>
      <CardDescription>
        Laden Sie weitere Personen per E-Mail ein, die Kita mitzuverwalten. Als
        Admins legen sie Bretter an und entfernen Zettel; einladen, Mitglieder
        entfernen und die Kita umbenennen können nur Sie. Der Link in der E-Mail
        gilt {{ INVITATION_TTL_DAYS }} Tage.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <form @submit.prevent="invite">
        <FieldGroup>
          <FormError :message="error" />
          <Field>
            <FieldLabel for="invitation-email">E-Mail-Adresse</FieldLabel>
            <Input
              id="invitation-email"
              v-model="email"
              type="email"
              autocomplete="off"
              required
            />
          </Field>
          <Button type="submit" class="self-start" :disabled="pending">
            Einladung senden
          </Button>
        </FieldGroup>
      </form>
      <div v-if="props.invitations.length" class="space-y-2">
        <h3 id="open-invitations-heading" class="text-sm font-medium">
          Offene Einladungen ({{ props.invitations.length }} von
          {{ INVITATION_LIMIT }})
        </h3>
        <ul
          aria-labelledby="open-invitations-heading"
          class="divide-y rounded-md border text-sm"
        >
          <li
            v-for="invitation in props.invitations"
            :key="invitation.id"
            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{{ invitation.email }}</p>
              <p class="text-muted-foreground">
                gültig bis {{ invitation.expires }}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              :disabled="cancelling"
              :aria-label="`Zurückziehen: Einladung an ${invitation.email}`"
              @click="cancel(invitation)"
            >
              Zurückziehen
            </Button>
          </li>
        </ul>
      </div>
    </CardContent>
  </Card>
</template>
