<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  useId,
  useTemplateRef,
  watch,
} from 'vue'

import BoardAlert from '@/components/board/BoardAlert.vue'
import NoteReportOperator from '@/components/board/NoteReportOperator.vue'
import NoteReportOutcome from '@/components/board/NoteReportOutcome.vue'
import {
  pillButtonClass,
  reportOptionClass,
  textFieldClass,
} from '@/components/board/classes'
import {
  REPORT_REASONS,
  REPORT_REMARKS_MAX,
  type OperatorReportOutcome,
  type ReportDraft,
} from '@/lib/reports/types'

// The report form inside the note's dialog (NoteDetail.vue): a reason, and
// whatever else the visitor wants to say. No name, no address — unless the
// visitor also reports the note to the operator as illegal content, which
// the form offers where the instance names an operator address
// (src/lib/reports/operator-notice.ts): then name and address are optional
// and the statement of good faith is required. Once the report is in, the
// form gives way to the thanks, which takes the focus so screen readers read
// it out.
const props = defineProps<{
  pending: boolean
  error: string | null
  // The report went through
  done: boolean
  // Whether the operator's mail went out; undefined without the option
  operator: OperatorReportOutcome | undefined
  // OPERATOR_EMAIL; empty: the option isn't offered
  operatorEmail: string
  // Where the privacy policy lives on this instance
  privacyHref: string
}>()

const emit = defineEmits<{ send: [draft: ReportDraft]; cancel: [] }>()

const draft = reactive<ReportDraft>({
  reason: '',
  remarks: '',
  website: '',
  toOperator: false,
  notifierName: '',
  notifierEmail: '',
  goodFaith: false,
})
const remarksCountId = useId()
const thanksText = computed(() =>
  props.operator?.operatorNotified
    ? 'Danke für deinen Hinweis. Die Kita und der Betreiber werden informiert.'
    : 'Danke für deinen Hinweis. Die Verantwortlichen werden informiert.',
)
const thanks = useTemplateRef<HTMLParagraphElement>('thanks')
const heading = useTemplateRef<HTMLHeadingElement>('heading')

// Opened from the button in the dialog: the focus moves to the form
onMounted(() => heading.value?.focus())

watch(
  () => props.done,
  async (done) => {
    if (!done) return
    await nextTick()
    thanks.value?.focus()
  },
)

// Enter in the text field would send again while the first one is on its
// way, and the button only says it is disabled, so it keeps the focus
function submit() {
  if (props.pending) return
  emit('send', { ...draft })
}
</script>

<template>
  <div class="border-tinte/15 border-t-2 border-dashed pt-5">
    <template v-if="done">
      <p ref="thanks" tabindex="-1" role="status" class="font-semibold">
        {{ thanksText }}
      </p>
      <NoteReportOutcome :operator="operator" :operator-email="operatorEmail" />
    </template>
    <form v-else class="grid gap-4" @submit.prevent="submit">
      <h3
        ref="heading"
        tabindex="-1"
        class="text-lg font-bold focus:outline-none"
      >
        Zettel melden
      </h3>
      <p class="text-tinte/70 -mt-2 text-sm">
        Die Kita sieht deine Meldung, aber nicht, wer sie geschickt hat. Der
        Zettel bleibt hängen, bis sie entschieden hat.
      </p>
      <fieldset>
        <legend class="text-base font-semibold">Was stimmt nicht?</legend>
        <div class="mt-2 grid gap-2">
          <label
            v-for="reason in REPORT_REASONS"
            :key="reason.id"
            :class="reportOptionClass"
          >
            <input
              v-model="draft.reason"
              type="radio"
              name="report-reason"
              :value="reason.id"
              required
              class="accent-tinte size-4"
            />
            {{ reason.label }}
          </label>
        </div>
      </fieldset>

      <!-- The counter describes the field, so its name stays the same while
           typing -->
      <div>
        <div class="flex justify-between">
          <label for="report-remarks" class="text-base font-semibold">
            Weitere Hinweise
            <span class="text-tinte/75 font-normal">(optional)</span>
          </label>
          <span :id="remarksCountId" class="text-tinte/75">
            {{ draft.remarks.length }}/{{ REPORT_REMARKS_MAX }}
            <span class="sr-only">Zeichen</span>
          </span>
        </div>
        <textarea
          id="report-remarks"
          v-model="draft.remarks"
          :aria-describedby="remarksCountId"
          :maxlength="REPORT_REMARKS_MAX"
          rows="3"
          :class="[textFieldClass, 'resize-y']"
        />
      </div>

      <!-- A notice of illegal content to the operator (DSA Art. 16), on top
           of the report to the Kita -->
      <NoteReportOperator
        v-if="operatorEmail"
        v-model:to-operator="draft.toOperator"
        v-model:name="draft.notifierName"
        v-model:email="draft.notifierEmail"
        v-model:good-faith="draft.goodFaith"
        :privacy-href="privacyHref"
      />

      <!-- Honeypot for bots, like the one of the note form -->
      <label aria-hidden="true" class="sr-only">
        Website
        <input
          v-model="draft.website"
          name="kb-r7"
          tabindex="-1"
          autocomplete="off"
        />
      </label>

      <BoardAlert :message="error" />

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          class="hover:bg-tinte/5 font-semibold"
          :class="pillButtonClass"
          @click="emit('cancel')"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          :aria-disabled="pending"
          class="bg-tinte hover:bg-tinte/90 font-bold text-white"
          :class="pillButtonClass"
        >
          {{ pending ? 'Wird gesendet …' : 'Meldung senden' }}
        </button>
      </div>
    </form>
  </div>
</template>
