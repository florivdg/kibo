<script setup lang="ts">
import { computed, reactive, useId, watch } from 'vue'

import BoardAlert from '@/components/board/BoardAlert.vue'
import BoardDialog from '@/components/board/BoardDialog.vue'
import {
  inlineLinkClass,
  pillButtonClass,
  textFieldClass,
} from '@/components/board/classes'
import { paperClass } from '@/components/board/tones'
import {
  NOTE_AUTHOR_MAX,
  NOTE_BODY_MAX,
  NOTE_CONTACT_MAX,
  NOTE_DURATIONS,
  NOTE_TITLE_MAX,
  type BoardCategory,
  type BoardHints,
  type NoteDraft,
} from '@/lib/board/types'
import { rejectBlank } from '@/lib/reject-blank'

const props = defineProps<{
  open: boolean
  categories: BoardCategory[]
  hints: BoardHints
  initialCategoryId: string | null
  pending: boolean
  error: string | null
  // Where the privacy policy lives on this instance
  privacyHref: string
  // Fetches the form token the note will be sent with: on opening, not with
  // the page, so it has ripened by the time the note is written
  prepare: () => void
  // Resolves to true once the note hangs on the board
  pin: (draft: NoteDraft) => Promise<boolean>
}>()

const emit = defineEmits<{ close: []; closed: [] }>()

function emptyDraft(): NoteDraft {
  return {
    categoryId: props.initialCategoryId ?? props.categories[0]?.id ?? '',
    title: '',
    body: '',
    author: '',
    contact: '',
    durationDays: 14,
    website: '',
  }
}

const draft = reactive<NoteDraft>(emptyDraft())
const bodyCountId = useId()

// The draft survives closing the dialog and is only cleared once pinned. A
// note not started yet goes under the active filter. Every opening asks for a
// form token; one that is still good is kept.
const untouched = () => !draft.title && !draft.body
watch(
  () => props.open,
  (open) => {
    if (!open) return
    props.prepare()
    if (untouched()) {
      draft.categoryId = props.initialCategoryId ?? draft.categoryId
    }
  },
)

const selectedTone = computed(
  () =>
    props.categories.find((c) => c.id === draft.categoryId)?.tone ?? 'sonne',
)

const optionClass =
  'flex cursor-pointer items-center gap-2 rounded-full border-2 border-tinte/15 px-4 py-2 font-semibold has-checked:border-tinte has-checked:bg-tinte has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-tinte'

// Guards against a double submit: the button only says it is disabled while
// pinning (a disabled button would drop the focus), and Enter in a text field
// would fire the form again anyway
async function submit() {
  if (props.pending) return
  const sent = { ...draft }
  if (!(await props.pin(sent))) return
  // Closed and reopened while a slow pin was under way, the visitor may have
  // started on the next note already: that one stays, and so does the dialog
  if (JSON.stringify(draft) !== JSON.stringify(sent)) return
  Object.assign(draft, emptyDraft())
  emit('close')
}
</script>

<template>
  <BoardDialog
    :open="open"
    labelledby="composer-title"
    @close="emit('close')"
    @closed="emit('closed')"
  >
    <form class="grid gap-5" @submit.prevent="submit">
      <div class="flex items-center gap-3">
        <span
          aria-hidden="true"
          class="size-5 rotate-6 rounded-md transition-colors"
          :class="paperClass[selectedTone]"
        />
        <h2 id="composer-title" class="text-2xl font-bold">Zettel anpinnen</h2>
      </div>

      <fieldset>
        <legend class="text-base font-semibold">Worum geht es?</legend>
        <div class="mt-2 flex flex-wrap gap-2">
          <label
            v-for="category in categories"
            :key="category.id"
            :class="optionClass"
          >
            <input
              v-model="draft.categoryId"
              type="radio"
              name="category"
              :value="category.id"
              class="sr-only"
            />
            <span
              aria-hidden="true"
              class="ring-tinte/20 size-3 rounded-full ring-1"
              :class="paperClass[category.tone]"
            />
            {{ category.label }}
          </label>
        </div>
      </fieldset>

      <label class="block">
        <span class="text-base font-semibold">Überschrift</span>
        <input
          v-model="draft.title"
          :maxlength="NOTE_TITLE_MAX"
          required
          @input="rejectBlank($event, 'Bitte gib eine Überschrift ein.')"
          :placeholder="hints.titlePlaceholder"
          :class="textFieldClass"
        />
      </label>

      <!-- The counter describes the field instead of being part of its name,
           which would otherwise change with every key -->
      <div>
        <div class="flex justify-between">
          <label for="note-body" class="text-base font-semibold">
            Was sollen andere wissen?
          </label>
          <span :id="bodyCountId" class="text-tinte/75">
            {{ draft.body.length }}/{{ NOTE_BODY_MAX }}
            <span class="sr-only">Zeichen</span>
          </span>
        </div>
        <textarea
          id="note-body"
          v-model="draft.body"
          :aria-describedby="bodyCountId"
          :maxlength="NOTE_BODY_MAX"
          rows="4"
          required
          @input="rejectBlank($event, 'Bitte schreib etwas dazu.')"
          :placeholder="hints.bodyPlaceholder"
          :class="[textFieldClass, 'resize-y']"
        />
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
        <label class="block">
          <span class="text-base font-semibold">Dein Name</span>
          <input
            v-model="draft.author"
            :maxlength="NOTE_AUTHOR_MAX"
            required
            @input="rejectBlank($event, 'Bitte gib deinen Namen ein.')"
            autocomplete="off"
            placeholder="z. B. Mama von Ida"
            :class="textFieldClass"
          />
        </label>
        <label class="block">
          <span class="text-base font-semibold">
            Kontakt <span class="text-tinte/75 font-normal">(optional)</span>
          </span>
          <input
            v-model="draft.contact"
            :maxlength="NOTE_CONTACT_MAX"
            placeholder="Telefon oder Gruppe"
            :class="textFieldClass"
          />
        </label>
      </div>

      <fieldset>
        <legend class="text-base font-semibold">
          Wie lange hängen lassen?
        </legend>
        <div class="mt-2 flex flex-wrap gap-2">
          <label
            v-for="days in NOTE_DURATIONS"
            :key="days"
            :class="optionClass"
          >
            <input
              v-model="draft.durationDays"
              type="radio"
              name="duration"
              :value="days"
              class="sr-only"
            />
            {{ days }} Tage
          </label>
        </div>
      </fieldset>

      <!-- Honeypot for bots, invisible and unreachable for people. The name
           means nothing to autofill, which would otherwise fill it in. -->
      <label aria-hidden="true" class="sr-only">
        Website
        <input
          v-model="draft.website"
          name="kb-f7"
          tabindex="-1"
          autocomplete="off"
        />
      </label>

      <div class="text-tinte/70 grid gap-2 text-sm leading-relaxed">
        <p>
          Alle mit dem Link zu diesem Brett sehen deinen Zettel. Gib nur
          Kontaktdaten an, die du teilen möchtest.
        </p>
        <p>
          Abnehmen kannst du deinen Zettel nur in diesem Browser auf diesem
          Gerät.
          <a
            :href="privacyHref"
            target="_blank"
            rel="noopener"
            :class="inlineLinkClass"
          >
            Datenschutz<span class="sr-only"> (öffnet in neuem Tab)</span>
          </a>
        </p>
      </div>

      <BoardAlert :message="error" />

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          class="hover:bg-tinte/5 font-semibold"
          :class="pillButtonClass"
          @click="emit('close')"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          :aria-disabled="pending"
          class="bg-kirsche hover:bg-kirsche/90 font-bold text-white"
          :class="pillButtonClass"
        >
          {{ pending ? 'Wird angepinnt …' : 'Zettel anpinnen' }}
        </button>
      </div>
    </form>
  </BoardDialog>
</template>
