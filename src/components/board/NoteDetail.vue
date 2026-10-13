<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'

import BoardDialog from '@/components/board/BoardDialog.vue'
import NotePin from '@/components/board/NotePin.vue'
import NoteReport from '@/components/board/NoteReport.vue'
import NoteTakeDown from '@/components/board/NoteTakeDown.vue'
import { notePin, paperClass } from '@/components/board/tones'
import { postedLabel, takenDownLabel } from '@/lib/board/time'
import type { BoardCategory, Note } from '@/lib/board/types'
import type { OperatorReportOutcome, ReportDraft } from '@/lib/reports/types'

const props = defineProps<{
  note: Note | null
  category: BoardCategory | undefined
  now: Date
  // Pinned from this browser, so it can be taken down here
  own: boolean
  pending: boolean
  error: string | null
  // Reporting the note: the request under way, its error, and whether it
  // went through (src/components/board/BoardApp.vue keeps all three)
  reportPending: boolean
  reportError: string | null
  reported: boolean
  // Whether the operator heard of it too; undefined without that option
  operator: OperatorReportOutcome | undefined
  // OPERATOR_EMAIL; empty: the report form doesn't offer the operator
  operatorEmail: string
  privacyHref: string
}>()

const emit = defineEmits<{
  close: []
  // Once closed, with the focus back where it was (BoardDialog.vue)
  closed: []
  takeDown: []
  report: [draft: ReportDraft]
  // The report form opens or is cancelled: a refusal from before is over
  resetReport: []
}>()

// The report form is opened from the dialog, and closed again for the next
// note
const reporting = ref(false)
watch(
  () => props.note?.id,
  () => (reporting.value = false),
)

// Opening the form focuses its heading; cancelling it removes the form with
// the focus inside, so the focus goes back to the button that opened it
const reportTrigger = useTemplateRef<HTMLButtonElement>('reportTrigger')

async function toggleReport(open: boolean) {
  reporting.value = open
  emit('resetReport')
  if (open) return
  await nextTick()
  reportTrigger.value?.focus()
}
</script>

<template>
  <BoardDialog
    :open="!!note"
    labelledby="note-detail-title"
    @close="emit('close')"
    @closed="emit('closed')"
  >
    <template v-if="note && category">
      <div
        class="relative rounded-[1.5rem_1.1rem_1.7rem_1.2rem] px-5 pt-9 pb-6 wrap-anywhere"
        :class="paperClass[category.tone]"
      >
        <NotePin :color="notePin(note.id)" />
        <p class="text-tinte/80 text-sm font-semibold">{{ category.label }}</p>
        <h2
          id="note-detail-title"
          class="mt-1 text-2xl leading-snug font-bold text-balance"
        >
          {{ note.title }}
        </h2>
        <p class="mt-3 text-lg leading-relaxed whitespace-pre-line">
          {{ note.body }}
        </p>
      </div>

      <dl class="mt-6 grid gap-4">
        <div>
          <dt class="text-tinte/70 text-sm">Angepinnt von</dt>
          <dd class="text-lg font-semibold wrap-anywhere">
            {{ note.author }},
            <time :datetime="note.createdAt">
              {{ postedLabel(note.createdAt, now) }}
            </time>
          </dd>
        </div>
        <div v-if="note.contact">
          <dt class="text-tinte/70 text-sm">Kontakt</dt>
          <dd class="text-lg font-semibold wrap-anywhere">
            {{ note.contact }}
          </dd>
        </div>
      </dl>
      <p class="text-tinte/70 mt-4 text-sm">
        <time :datetime="note.expiresAt">
          {{ takenDownLabel(note.expiresAt, now) }}
        </time>
      </p>

      <!-- Keyed so the confirmation step starts over for each note -->
      <NoteTakeDown
        v-if="own"
        :key="note.id"
        class="mt-6"
        :pending="pending"
        :error="error"
        @take-down="emit('takeDown')"
      />

      <!-- Out of the way: a note is reported now and then, read every day.
           Nobody reports their own. -->
      <NoteReport
        v-if="reporting || reported"
        :key="note.id"
        class="mt-6"
        :pending="reportPending"
        :error="reportError"
        :done="reported"
        :operator="operator"
        :operator-email="operatorEmail"
        :privacy-href="privacyHref"
        @send="emit('report', $event)"
        @cancel="toggleReport(false)"
      />
      <p v-else-if="!own" class="mt-6 text-center">
        <button
          ref="reportTrigger"
          type="button"
          class="text-tinte/70 hover:text-tinte focus-visible:outline-tinte rounded-sm text-sm underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2"
          @click="toggleReport(true)"
        >
          Zettel melden
        </button>
      </p>

      <!-- Focused first, so opening a note never lands on "Zettel abnehmen" -->
      <button
        type="button"
        autofocus
        class="border-tinte/15 hover:border-tinte/40 focus-visible:outline-tinte mt-4 w-full rounded-full border-2 px-6 py-3 text-base font-semibold focus-visible:outline-3 focus-visible:outline-offset-2"
        @click="emit('close')"
      >
        Schließen
      </button>
    </template>
  </BoardDialog>
</template>
