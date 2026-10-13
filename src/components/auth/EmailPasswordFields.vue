<script setup lang="ts">
import { useId } from 'vue'

import EmailField from '@/components/auth/EmailField.vue'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PASSWORD_MIN_LENGTH } from '@/lib/limits'

// `newPassword` switches autocomplete and shows the length requirement.
// `emailReadonly`: the address is given (an invitation) and can't be changed.
// Without `newPassword` this is the login, where the e-mail field also
// offers the account's passkeys (`webauthn`, see EmailField).
defineProps<{ newPassword?: boolean; emailReadonly?: boolean }>()
const email = defineModel<string>('email', { required: true })
const password = defineModel<string>('password', { required: true })
const hintId = useId()
</script>

<template>
  <EmailField
    v-model="email"
    :readonly="emailReadonly"
    :autocomplete="newPassword ? 'email' : 'username webauthn'"
  />
  <Field>
    <FieldLabel for="password">Passwort</FieldLabel>
    <Input
      id="password"
      v-model="password"
      type="password"
      :autocomplete="newPassword ? 'new-password' : 'current-password'"
      :minlength="newPassword ? PASSWORD_MIN_LENGTH : undefined"
      required
      :aria-describedby="newPassword ? hintId : undefined"
    />
    <FieldDescription v-if="newPassword" :id="hintId"
      >Mindestens {{ PASSWORD_MIN_LENGTH }} Zeichen.</FieldDescription
    >
  </Field>
</template>
