<script setup lang="ts">
import { useId } from 'vue'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldAria } from '@/lib/field-aria'
import { PASSWORD_MIN_LENGTH } from '@/lib/limits'

// A new password typed twice; the form compares them before submitting.
// `mismatchError`: the id of the form's error while it says the two differ.
defineProps<{ mismatchError?: string | false }>()
const password = defineModel<string>('password', { required: true })
const repeated = defineModel<string>('repeated', { required: true })
const hintId = useId()
</script>

<template>
  <Field>
    <FieldLabel for="new-password">Neues Passwort</FieldLabel>
    <Input
      id="new-password"
      v-model="password"
      type="password"
      autocomplete="new-password"
      :minlength="PASSWORD_MIN_LENGTH"
      required
      :aria-describedby="hintId"
    />
    <FieldDescription :id="hintId"
      >Mindestens {{ PASSWORD_MIN_LENGTH }} Zeichen.</FieldDescription
    >
  </Field>
  <Field>
    <FieldLabel for="new-password-repeat">Passwort wiederholen</FieldLabel>
    <Input
      id="new-password-repeat"
      v-model="repeated"
      type="password"
      autocomplete="new-password"
      :minlength="PASSWORD_MIN_LENGTH"
      required
      v-bind="fieldAria({ error: mismatchError })"
    />
  </Field>
</template>
