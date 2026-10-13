<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'

// The box an account of the hosted instance ticks to agree to the terms and
// the data processing agreement: before its first Kita, or with an invoice
// request when that is still open. The server insists on it either way. Both
// links lead to the version that is agreed to (termsLinks in
// src/lib/legal.ts), which the box names, and open in a new window, so the
// form stays as it is.
defineProps<{ agbHref: string; avvHref: string; version: string }>()

const accepted = defineModel<boolean>({ required: true })

const NEW_WINDOW = '(öffnet in neuem Fenster)'
</script>

<template>
  <Field orientation="horizontal" class="items-start">
    <Checkbox id="accept-terms" v-model="accepted" class="mt-0.5" />
    <FieldLabel for="accept-terms" class="leading-snug font-normal">
      <span>
        Ich stimme den
        <a
          :href="agbHref"
          target="_blank"
          rel="noopener"
          class="underline underline-offset-4"
        >
          AGB<span class="sr-only"> {{ NEW_WINDOW }}</span></a
        >
        und dem
        <a
          :href="avvHref"
          target="_blank"
          rel="noopener"
          class="underline underline-offset-4"
        >
          Vertrag zur Auftragsverarbeitung<span class="sr-only">
            {{ NEW_WINDOW }}</span
          ></a
        >
        in der Fassung {{ version }} zu.
      </span>
    </FieldLabel>
  </Field>
</template>
