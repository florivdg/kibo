<script setup lang="ts">
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ORGANIZATION_NAME_MAX } from '@/lib/limits'
import { rejectBlank } from '@/lib/reject-blank'

const name = defineModel<string>({ required: true })
</script>

<template>
  <Field>
    <FieldLabel for="organization-name">Name der Kita</FieldLabel>
    <!-- The server counts the characters after trimming -->
    <Input
      id="organization-name"
      v-model="name"
      autocomplete="organization"
      :maxlength="ORGANIZATION_NAME_MAX"
      required
      @input="rejectBlank($event, 'Bitte geben Sie einen Namen ein.')"
    />
  </Field>
</template>
