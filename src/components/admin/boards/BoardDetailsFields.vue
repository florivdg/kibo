<script setup lang="ts">
import { useId } from 'vue'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { rejectBlank } from '@/lib/reject-blank'
import { BOARD_DESCRIPTION_MAX, BOARD_NAME_MAX } from '@/lib/board/types'

const name = defineModel<string>('name', { required: true })
const description = defineModel<string>('description', { required: true })
const hintId = useId()
</script>

<template>
  <Field>
    <FieldLabel for="board-name">Name</FieldLabel>
    <Input
      id="board-name"
      v-model="name"
      :maxlength="BOARD_NAME_MAX"
      required
      @input="rejectBlank($event, 'Bitte geben Sie einen Namen ein.')"
    />
  </Field>
  <Field>
    <FieldLabel for="board-description">
      Beschreibung
      <span class="font-normal text-muted-foreground">(optional)</span>
    </FieldLabel>
    <Textarea
      id="board-description"
      v-model="description"
      :maxlength="BOARD_DESCRIPTION_MAX"
      rows="3"
      :aria-describedby="hintId"
    />
    <FieldDescription :id="hintId">
      Steht oben auf dem Brett. Erklären Sie kurz, wofür es gedacht ist.
    </FieldDescription>
  </Field>
</template>
