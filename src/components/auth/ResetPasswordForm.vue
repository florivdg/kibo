<script setup lang="ts">
import { ref, useId } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import NewPasswordFields from '@/components/auth/NewPasswordFields.vue'
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
import { PASSWORD_MISMATCH, PASSWORD_RESET_MARKER } from '@/lib/auth-errors'

const props = defineProps<{ token: string }>()

const password = ref('')
const repeated = ref('')
const { error, errorCode, pending, refuse, run } = useFormSubmit()
const errorId = useId()

async function submit() {
  if (password.value !== repeated.value) {
    refuse('PASSWORD_MISMATCH', PASSWORD_MISMATCH)
    return
  }
  // Resetting ends every session, so the new password is used right away
  await run(
    () =>
      authClient.resetPassword({
        newPassword: password.value,
        token: props.token,
      }),
    { leave: { href: `/admin/login?${PASSWORD_RESET_MARKER}=1` } },
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Neues Passwort vergeben</CardHeading>
      <CardDescription>
        Danach melden Sie sich mit dem neuen Passwort an. Hinterlegte Passkeys
        werden dabei entfernt.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :id="errorId" :message="error" />
          <NewPasswordFields
            v-model:password="password"
            v-model:repeated="repeated"
            :mismatch-error="errorCode === 'PASSWORD_MISMATCH' && errorId"
          />
          <Button type="submit" :disabled="pending">Passwort speichern</Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
