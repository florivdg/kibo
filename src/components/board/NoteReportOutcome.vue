<script setup lang="ts">
import { inlineLinkClass } from '@/components/board/classes'
import type { OperatorReportOutcome } from '@/lib/reports/types'

// Under the thanks of the report form (NoteReport.vue): what happens next —
// the Kita checks the note, the operator does too, or the operator's mail
// didn't go out and the visitor writes to them directly
defineProps<{
  // undefined: the report didn't go to the operator
  operator: OperatorReportOutcome | undefined
  operatorEmail: string
}>()
</script>

<template>
  <p
    v-if="operator?.operatorNotified === false"
    class="text-tinte/70 mt-1 text-sm"
  >
    Die Nachricht an den Betreiber ist nicht angekommen. Schreib ihm bitte
    direkt an
    <a :href="`mailto:${operatorEmail}`" :class="inlineLinkClass">{{
      operatorEmail
    }}</a
    >.
  </p>
  <p v-else-if="operator" class="text-tinte/70 mt-1 text-sm">
    Der Betreiber prüft den Zettel.
    <template v-if="operator.receiptSent">
      Eine Eingangsbestätigung ist an deine E-Mail-Adresse unterwegs, über seine
      Entscheidung schreibt er dir dorthin.
    </template>
  </p>
  <p v-else class="text-tinte/70 mt-1 text-sm">
    Der Zettel bleibt sichtbar, bis die Kita ihn geprüft hat.
  </p>
</template>
