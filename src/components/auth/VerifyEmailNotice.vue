<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import BackToLoginLink from '@/components/auth/BackToLoginLink.vue'
import EmailField from '@/components/auth/EmailField.vue'
import FormError from '@/components/auth/FormError.vue'
import FormNotice from '@/components/auth/FormNotice.vue'
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
import { authErrorMessage } from '@/lib/auth-errors'
import { VERIFY_EMAIL_CALLBACK } from '@/lib/auth-paths'

// `linkError` is set when Better Auth bounced a verification link back here;
// the login page links here with just the address when it isn't confirmed yet
const props = defineProps<{
  email: string
  linkError: string | null
  verified: boolean
}>()

const email = ref(props.email)
const resent = ref(false)
const { error, pending, run } = useFormSubmit()
const linkErrorMessage = props.linkError
  ? authErrorMessage({ code: props.linkError })
  : null

async function submit() {
  const ok = await run(() =>
    authClient.sendVerificationEmail({
      email: email.value,
      callbackURL: VERIFY_EMAIL_CALLBACK,
    }),
  )
  resent.value = !!ok
}
</script>

<template>
  <!-- Confirming only unlocks the login; it deliberately grants no session, so
       that a link from the mailbox can't skip the password and 2FA -->
  <Card v-if="verified && !linkErrorMessage">
    <CardHeader>
      <CardHeading :level="1">E-Mail-Adresse bestätigt</CardHeading>
      <CardDescription>Melden Sie sich jetzt an.</CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Button as="a" href="/admin/login">Zur Anmeldung</Button>
      </FieldGroup>
    </CardContent>
  </Card>
  <Card v-else>
    <CardHeader>
      <CardHeading :level="1">E-Mail-Adresse bestätigen</CardHeading>
      <CardDescription>
        {{
          linkErrorMessage
            ? 'Wir schicken Ihnen gerne einen neuen Bestätigungslink.'
            : 'Wir haben Ihnen einen Bestätigungslink geschickt. Öffnen Sie ihn, um sich anmelden zu können.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="linkErrorMessage" />
          <FormError :message="error" />
          <FormNotice
            :message="
              resent ? 'Wir haben Ihnen eine neue E-Mail geschickt.' : null
            "
          />
          <EmailField v-model="email" />
          <Button type="submit" variant="outline" :disabled="pending">
            Bestätigungslink erneut senden
          </Button>
          <BackToLoginLink />
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
