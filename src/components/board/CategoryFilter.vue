<script setup lang="ts">
import { paperClass } from '@/components/board/tones'
import type { BoardCategory } from '@/lib/board/types'

defineProps<{
  categories: BoardCategory[]
  counts: Record<string, number>
  total: number
}>()

// null shows all notes
const selected = defineModel<string | null>({ required: true })
</script>

<template>
  <!-- The scroll container clips whatever sticks out, so the padding (offset
       by the margin) leaves room for the focus outlines -->
  <div
    role="group"
    aria-label="Zettel filtern"
    class="-mx-4 -mt-2 flex gap-2 overflow-x-auto px-4 pt-2 pb-2 sm:-mx-2 sm:px-2"
  >
    <button
      type="button"
      :aria-pressed="selected === null"
      class="focus-visible:outline-tinte shrink-0 rounded-full px-4 py-2 text-base font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2"
      :class="
        selected === null
          ? 'bg-tinte text-white'
          : 'text-tinte bg-white/60 hover:bg-white'
      "
      @click="selected = null"
    >
      Alle <span class="font-normal opacity-75">{{ total }}</span>
    </button>
    <button
      v-for="category in categories"
      :key="category.id"
      type="button"
      :aria-pressed="selected === category.id"
      class="focus-visible:outline-tinte flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2"
      :class="
        selected === category.id
          ? 'bg-tinte text-white'
          : 'text-tinte bg-white/60 hover:bg-white'
      "
      @click="selected = category.id"
    >
      <span
        aria-hidden="true"
        class="ring-tinte/20 size-3 rounded-full ring-1"
        :class="paperClass[category.tone]"
      />
      {{ category.label }}
      <span class="font-normal opacity-75">{{ counts[category.id] ?? 0 }}</span>
    </button>
  </div>
</template>
