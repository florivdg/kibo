<script setup lang="ts">
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

// `autocomplete`: the login page adds `webauthn`, which lets the browser
// offer passkeys in this field (src/composables/use-passkey-sign-in.ts)
withDefaults(
  defineProps<{
    readonly?: boolean
    autocomplete?: 'email' | 'username webauthn'
  }>(),
  { autocomplete: 'email' },
)
const email = defineModel<string>({ required: true })
</script>

<template>
  <Field>
    <FieldLabel for="email">E-Mail-Adresse</FieldLabel>
    <Input
      id="email"
      v-model="email"
      type="email"
      :autocomplete="autocomplete"
      :readonly="readonly"
      required
    />
  </Field>
</template>
