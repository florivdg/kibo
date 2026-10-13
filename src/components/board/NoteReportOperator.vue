<script setup lang="ts">
import {
  inlineLinkClass,
  reportOptionClass,
  textFieldClass,
} from '@/components/board/classes'
import { EMAIL_MAX_LENGTH } from '@/lib/limits'
import { REPORT_NOTIFIER_NAME_MAX } from '@/lib/reports/types'

// The part of the report form (NoteReport.vue) that also tells the operator:
// a notice of illegal content (DSA Art. 16; src/lib/reports/operator-notice.ts).
// Name and address are optional, the statement of good faith is required
// once the option is on.
defineProps<{
  // Where the privacy policy lives on this instance
  privacyHref: string
}>()

const toOperator = defineModel<boolean>('toOperator', { required: true })
const name = defineModel<string>('name', { required: true })
const email = defineModel<string>('email', { required: true })
const goodFaith = defineModel<boolean>('goodFaith', { required: true })
</script>

<template>
  <div class="grid gap-3">
    <label :class="reportOptionClass">
      <input v-model="toOperator" type="checkbox" class="accent-tinte size-4" />
      Rechtswidriger Inhalt – auch an den Betreiber melden
    </label>
    <template v-if="toOperator">
      <p class="text-tinte/70 text-sm">
        Der Betreiber von Kibo prüft Hinweise auf rechtswidrige Inhalte. Name
        und E-Mail-Adresse stehen nur in der E-Mail an ihn; die Kita bekommt sie
        nicht, und Kibo speichert sie nicht. Mit E-Mail-Adresse bekommst du eine
        Eingangsbestätigung und seine Entscheidung. Ist jemand in Gefahr, ruf
        die Polizei: 110.
        <a
          :href="privacyHref"
          target="_blank"
          rel="noopener"
          :class="inlineLinkClass"
        >
          Datenschutz<span class="sr-only"> (öffnet in neuem Tab)</span>
        </a>
      </p>
      <div>
        <label for="report-name" class="text-base font-semibold">
          Dein Name
          <span class="text-tinte/75 font-normal">(optional)</span>
        </label>
        <input
          id="report-name"
          v-model="name"
          autocomplete="name"
          :maxlength="REPORT_NOTIFIER_NAME_MAX"
          :class="textFieldClass"
        />
      </div>
      <div>
        <label for="report-email" class="text-base font-semibold">
          Deine E-Mail-Adresse
          <span class="text-tinte/75 font-normal">(optional)</span>
        </label>
        <input
          id="report-email"
          v-model="email"
          type="email"
          autocomplete="email"
          :maxlength="EMAIL_MAX_LENGTH"
          :class="textFieldClass"
        />
      </div>
      <label class="flex cursor-pointer items-start gap-3 text-base">
        <input
          v-model="goodFaith"
          type="checkbox"
          required
          class="accent-tinte mt-1 size-4 shrink-0"
        />
        Ich bin überzeugt, dass meine Angaben richtig und vollständig sind.
      </label>
    </template>
  </div>
</template>
