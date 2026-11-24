<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import NewPasswordFields from '@/components/auth/NewPasswordFields.vue'
import ResetLinkError from '@/components/auth/ResetLinkError.vue'
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
import { PASSWORD_FORM_TEXTS, type PasswordFormMode } from '@/lib/password-form'

const props = defineProps<{ token: string; mode: PasswordFormMode }>()

const texts = computed(() => PASSWORD_FORM_TEXTS[props.mode])
const password = ref('')
const repeated = ref('')
const { error, errorCode, pending, refuse, run } = useFormSubmit()
const errorId = useId()
// The link is good for one password and an hour; past that, the form gives
// way to the page a rejected link shows
const linkGone = computed(
  () =>
    errorCode.value === 'INVALID_TOKEN' || errorCode.value === 'TOKEN_EXPIRED',
)

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
  <ResetLinkError v-if="linkGone" :code="errorCode" />
  <Card v-else>
    <CardHeader>
      <CardHeading :level="1">{{ texts.heading }}</CardHeading>
      <CardDescription>{{ texts.description }}</CardDescription>
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
