<script setup lang="ts">
import EmailField from '@/components/auth/EmailField.vue'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

// The login's fields. The e-mail field also offers the account's passkeys
// (`webauthn`, see EmailField).
const email = defineModel<string>('email', { required: true })
const password = defineModel<string>('password', { required: true })
</script>

<template>
  <EmailField v-model="email" autocomplete="username webauthn" />
  <Field>
    <FieldLabel for="password">Passwort</FieldLabel>
    <Input
      id="password"
      v-model="password"
      type="password"
      autocomplete="current-password"
      required
    />
  </Field>
</template>
