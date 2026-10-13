<script setup lang="ts">
import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import SignOutLink from '@/components/auth/SignOutLink.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'

// Shown to the signed-in account the invitation was sent to
const props = defineProps<{
  invitationId: string
  organizationName: string
  inviterName: string
}>()

const { error, pending, run } = useFormSubmit()

async function accept() {
  // Accepting also makes the Kita the active one
  await run(
    () =>
      authClient.organization.acceptInvitation({
        invitationId: props.invitationId,
      }),
    {
      leave: {
        href: '/admin',
        toast: `Sie verwalten jetzt die Kita „${props.organizationName}“ mit.`,
      },
    },
  )
}

// Without a Kita of their own, /admin leads on to creating one
async function reject() {
  await run(
    () =>
      authClient.organization.rejectInvitation({
        invitationId: props.invitationId,
      }),
    { leave: { href: '/admin' } },
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">
        Einladung zur Kita „{{ organizationName }}“
      </CardHeading>
      <CardDescription>
        {{ inviterName }} hat Sie eingeladen, die Kita „{{ organizationName }}“
        mitzuverwalten: Bretter anlegen, teilen und Zettel im Blick behalten.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <FormError :message="error" />
        <Button :disabled="pending" @click="accept">Einladung annehmen</Button>
        <Button variant="outline" :disabled="pending" @click="reject">
          Ablehnen
        </Button>
        <!-- Someone without a Kita is brought back here by every admin page
             until the invitation is answered; this is the other way out -->
        <p class="text-center text-sm text-muted-foreground">
          <SignOutLink />
        </p>
      </FieldGroup>
    </CardContent>
  </Card>
</template>
