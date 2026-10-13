<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import BoardAlert from '@/components/board/BoardAlert.vue'
import { pillButtonClass } from '@/components/board/classes'

const props = defineProps<{ pending: boolean; error: string | null }>()

const emit = defineEmits<{ takeDown: [] }>()

// Asks once more before the note is gone for good. One button for both
// steps, so the focus stays on it; the question is read out from the hint.
// While the note is on its way it only says it is disabled, for the same
// reason, and a second click goes nowhere.
const confirming = ref(false)
const hintId = useId()

const label = computed(() => {
  if (!confirming.value) return 'Zettel abnehmen'
  return props.pending ? 'Wird abgenommen …' : 'Ja, abnehmen'
})

function onClick() {
  if (!confirming.value) confirming.value = true
  else if (!props.pending) emit('takeDown')
}
</script>

<template>
  <div class="border-tinte/15 border-t-2 border-dashed pt-5">
    <p class="font-semibold">Das ist dein Zettel.</p>
    <p :id="hintId" aria-live="polite" class="text-tinte/70 mt-1 text-sm">
      {{
        confirming
          ? 'Wirklich abnehmen? Das lässt sich nicht rückgängig machen.'
          : 'Hat sich erledigt? Dann nimm ihn ab, damit das Brett übersichtlich bleibt.'
      }}
    </p>
    <BoardAlert :message="error" class="mt-3" />
    <button
      type="button"
      :aria-describedby="hintId"
      :aria-disabled="pending"
      class="border-kirsche mt-3 w-full border-2 font-bold"
      :class="[
        pillButtonClass,
        confirming
          ? 'bg-kirsche hover:bg-kirsche/90 text-white'
          : 'hover:bg-kirsche/10',
      ]"
      @click="onClick"
    >
      {{ label }}
    </button>
  </div>
</template>
