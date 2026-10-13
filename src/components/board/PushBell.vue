<script setup lang="ts">
import { Bell, BellRing } from '@lucide/vue'
import { computed } from 'vue'

import { roundButtonClass } from '@/components/board/classes'
import type { BellState } from '@/composables/use-push-bells'

// One board's bell; the state lives in usePushBells, shared by every bell of
// the page. Round, so it fits the board page's bar on a phone; from sm that
// one says what it does. `compact`: round at every width, the icon button of
// a card on the Kita page. Its `error` is the caller's to show (BoardAlert),
// where there is room for it.
const props = defineProps<
  BellState & { boardName: string; compact?: boolean }
>()

const emit = defineEmits<{ toggle: [] }>()

const label = computed(() => `Benachrichtigungen für „${props.boardName}“`)

// A busy bell only says it is disabled: a disabled button would drop the
// focus of whoever just pressed it
function onClick() {
  if (!props.disabled) emit('toggle')
}
</script>

<template>
  <!-- aria-pressed says on or off; the name stays the same. On, the bell
       also gets a dark rim: the yellow alone hardly stands out from the
       white card. -->
  <button
    type="button"
    :aria-pressed="on"
    :aria-label="label"
    :title="label"
    :aria-disabled="disabled"
    class="gap-2 border-2 text-sm font-semibold aria-disabled:opacity-70"
    :class="[
      roundButtonClass,
      on
        ? 'border-tinte bg-sonne hover:bg-sonne/80'
        : 'border-tinte/25 hover:bg-tinte/5',
      !compact && 'sm:w-auto sm:px-4',
      pending ? 'aria-disabled:cursor-wait' : 'aria-disabled:cursor-default',
    ]"
    @click="onClick"
  >
    <component
      :is="on ? BellRing : Bell"
      class="size-4 shrink-0"
      aria-hidden="true"
    />
    <span v-if="!compact" class="max-sm:hidden">
      Benachrichtigungen
      <span aria-hidden="true">{{ on ? 'an' : 'aus' }}</span>
    </span>
  </button>
</template>
