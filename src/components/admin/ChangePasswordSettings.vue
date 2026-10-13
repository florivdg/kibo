<script setup lang="ts">
import { ref, useId } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import FormNotice from '@/components/auth/FormNotice.vue'
import NewPasswordFields from '@/components/auth/NewPasswordFields.vue'
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
import { PASSWORD_MISMATCH } from '@/lib/auth-errors'
import { fieldAria } from '@/lib/field-aria'

const currentPassword = ref('')
const password = ref('')
const repeated = ref('')
const notice = ref<string | null>(null)
const { error, errorCode, pending, refuse, run } = useFormSubmit()
const errorId = useId()

async function submit() {
  notice.value = null
  if (password.value !== repeated.value) {
    refuse('PASSWORD_MISMATCH', PASSWORD_MISMATCH)
    return
  }
  // Other sessions end, as after a reset: changing the password is also how
  // an admin locks out someone who knew the old one. This browser gets a new
  // session and stays signed in.
  const ok = await run(() =>
    authClient.changePassword({
      currentPassword: currentPassword.value,
      newPassword: password.value,
      revokeOtherSessions: true,
    }),
  )
  if (!ok) return
  currentPassword.value = ''
  password.value = ''
  repeated.value = ''
  notice.value =
    'Ihr Passwort wurde geändert. Auf allen anderen Geräten sind Sie jetzt abgemeldet.'
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Passwort ändern</CardHeading>
      <CardDescription>
        Danach werden Sie auf allen anderen Geräten abgemeldet.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :id="errorId" :message="error" />
          <FormNotice :message="notice" />
          <Field>
            <FieldLabel for="change-password-current">
              Aktuelles Passwort
            </FieldLabel>
            <Input
              id="change-password-current"
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              required
              v-bind="
                fieldAria({
                  error: errorCode === 'INVALID_PASSWORD' && errorId,
                })
              "
            />
          </Field>
          <NewPasswordFields
            v-model:password="password"
            v-model:repeated="repeated"
            :mismatch-error="errorCode === 'PASSWORD_MISMATCH' && errorId"
          />
          <Button type="submit" class="self-start" :disabled="pending">
            Passwort ändern
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
