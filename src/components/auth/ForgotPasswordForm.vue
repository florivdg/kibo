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
import { RESET_PASSWORD_PATH } from '@/lib/auth-paths'

const email = ref('')
const sent = ref(false)
const { error, pending, run } = useFormSubmit()

async function submit() {
  const ok = await run(() =>
    authClient.requestPasswordReset({
      email: email.value,
      redirectTo: RESET_PASSWORD_PATH,
    }),
  )
  sent.value = !!ok
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Passwort vergessen</CardHeading>
      <CardDescription>
        Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort vergeben.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <!-- Unknown addresses get the same answer, so the notice stays vague -->
      <FieldGroup v-if="sent">
        <FormNotice
          message="Falls es zu dieser Adresse ein Konto gibt, ist die E-Mail unterwegs. Der Link ist eine Stunde gültig."
        />
        <BackToLoginLink />
      </FieldGroup>
      <form v-else @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <EmailField v-model="email" />
          <Button type="submit" :disabled="pending">Link anfordern</Button>
          <BackToLoginLink />
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
