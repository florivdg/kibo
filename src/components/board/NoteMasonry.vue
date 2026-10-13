<script setup lang="ts">
import { useMediaQuery, useMounted } from '@vueuse/core'
import { computed } from 'vue'

import NoteCard from '@/components/board/NoteCard.vue'
import type { BoardCategory, Note } from '@/lib/board/types'

const props = defineProps<{
  notes: Note[]
  categoriesById: Map<string, BoardCategory>
  now: Date
  lastPinnedId: string | null
}>()

const emit = defineEmits<{ open: [id: string] }>()

// Tailwind's sm and lg breakpoints
const mounted = useMounted()
const twoColumns = useMediaQuery('(min-width: 40rem)')
const threeColumns = useMediaQuery('(min-width: 64rem)')

// Round-robin placement puts the newest notes across the top, with each
// column read newest-first from top to bottom. The server doesn't know the
// screen, so until hydration is done a single "column" is laid out as a CSS
// grid: row by row, that puts every note in the column it ends up in, and
// the switch only lets the shorter notes move up.
// Reading order: a screen reader reads column by column, newest first within
// each, which is the order a sighted visitor sees; the notes are independent,
// so the interleaving across columns is no lost meaning.
const columns = computed(() => {
  if (!mounted.value) return [props.notes]
  const count = threeColumns.value ? 3 : twoColumns.value ? 2 : 1
  return Array.from({ length: count }, (_, column) =>
    props.notes.filter((_, index) => index % count === column),
  )
})
</script>

<template>
  <!-- Independent flex columns avoid WebKit's clipping/repainting of rotated
       cards and shadows at CSS multicol fragment boundaries. -->
  <div
    class="items-start gap-7"
    :class="mounted ? 'flex' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'"
  >
    <div
      v-for="(column, index) in columns"
      :key="index"
      :class="mounted ? 'flex min-w-0 flex-1 flex-col gap-7' : 'contents'"
    >
      <template v-for="note in column" :key="note.id">
        <NoteCard
          v-if="categoriesById.get(note.categoryId)"
          :note="note"
          :category="categoriesById.get(note.categoryId)!"
          :now="now"
          :just-pinned="note.id === lastPinnedId"
          @open="emit('open', note.id)"
        />
      </template>
    </div>
  </div>
</template>
