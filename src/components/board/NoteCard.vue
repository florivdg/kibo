<script setup lang="ts">
import { computed } from 'vue'

import NotePin from '@/components/board/NotePin.vue'
import { notePin, noteTilt, paperClass } from '@/components/board/tones'
import { daysLeft, postedLabel, takenDownLabel } from '@/lib/board/time'
import type { BoardCategory, Note } from '@/lib/board/types'

const props = defineProps<{
  note: Note
  category: BoardCategory
  now: Date
  justPinned: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const remaining = computed(() => daysLeft(props.note.expiresAt, props.now))
</script>

<template>
  <!-- The id lets the board scroll to and focus a note just pinned -->
  <article
    :id="`note-${note.id}`"
    class="note-paper relative px-5 pt-8 pb-5 wrap-anywhere focus-within:rotate-0 hover:rotate-0 motion-safe:transition-[rotate] motion-safe:duration-200"
    :class="[
      paperClass[category.tone],
      noteTilt(note.id),
      justPinned && 'motion-safe:animate-pin-drop',
    ]"
  >
    <NotePin :color="notePin(note.id)" />
    <p class="text-tinte/80 text-sm font-semibold">{{ category.label }}</p>
    <h2 class="mt-1 text-xl leading-snug font-bold text-balance">
      <!-- The stretched button makes the whole note clickable -->
      <button
        type="button"
        class="after:focus-visible:outline-tinte cursor-pointer text-left after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none after:focus-visible:outline-3 after:focus-visible:outline-offset-4"
        @click="emit('open')"
      >
        {{ note.title }}
      </button>
    </h2>
    <p class="mt-2 line-clamp-5 leading-relaxed whitespace-pre-line">
      {{ note.body }}
    </p>
    <footer
      class="text-tinte/80 mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
    >
      <span>{{ note.author }}</span>
      <!-- Relative dates carry the moment they stand for -->
      <time
        v-if="remaining <= 3"
        :datetime="note.expiresAt"
        class="text-tinte font-semibold"
      >
        {{
          remaining <= 1
            ? takenDownLabel(note.expiresAt, now)
            : `Noch ${remaining} Tage`
        }}
      </time>
      <time v-else :datetime="note.createdAt">
        {{ postedLabel(note.createdAt, now) }}
      </time>
    </footer>
  </article>
</template>
