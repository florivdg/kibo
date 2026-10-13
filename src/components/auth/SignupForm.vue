<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import EmailPasswordFields from '@/components/auth/EmailPasswordFields.vue'
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
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import { VERIFY_EMAIL_CALLBACK, VERIFY_EMAIL_PATH } from '@/lib/auth-paths'

// `invitation`: the sign-up was opened from an invitation to a Kita. The
// account has to be for the invited address, and the id goes along so that a
// closed instance lets the sign-up through (checkSignupPolicy in auth.ts).
const props = defineProps<{ invitation?: { id: string; email: string } }>()

const name = ref('')
const email = ref(props.invitation?.email ?? '')
const password = ref('')
const { error, pending, run } = useFormSubmit()

async function submit() {
  // Signing up doesn't sign the user in. Confirming the address only unlocks
  // the login; the Kita is created afterwards, on /admin/organizations/new —
  // or, with an invitation waiting, the login leads to the invitation.
  // Better Auth takes further keys in the body and ignores the ones it
  // doesn't know; as a variable, because its type doesn't list this one.
  const body = {
    name: name.value,
    email: email.value,
    password: password.value,
    callbackURL: VERIFY_EMAIL_CALLBACK,
    invitationId: props.invitation?.id,
  }
  await run(() => authClient.signUp.email(body), {
    leave: {
      href: `${VERIFY_EMAIL_PATH}?email=${encodeURIComponent(email.value)}`,
    },
  })
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Registrieren</CardHeading>
      <CardDescription>
        {{
          invitation
            ? 'Legen Sie ein Konto an, um die Einladung anzunehmen. Sie gilt für die unten genannte E-Mail-Adresse.'
            : 'Legen Sie ein Konto für Ihre Kita an.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <Field>
            <FieldLabel for="name">Ihr Name</FieldLabel>
            <Input id="name" v-model="name" autocomplete="name" required />
          </Field>
          <EmailPasswordFields
            v-model:email="email"
            v-model:password="password"
            new-password
            :email-readonly="!!invitation"
          />
          <Button type="submit" :disabled="pending">Konto anlegen</Button>
          <p class="text-center text-sm text-muted-foreground">
            Schon registriert?
            <a href="/admin/login" class="underline underline-offset-4">
              Anmelden
            </a>
          </p>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
