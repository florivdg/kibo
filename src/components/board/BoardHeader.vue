<script setup lang="ts">
import { ArrowLeft, Bell, BellOff } from '@lucide/vue'
import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'

import BoardAlert from '@/components/board/BoardAlert.vue'
import { roundButtonClass } from '@/components/board/classes'
import PushBell from '@/components/board/PushBell.vue'
import PushHint from '@/components/board/PushHint.vue'
import type { BellState } from '@/composables/use-push-bells'
import { kitaPath } from '@/lib/board/paths'
import type { PushState } from '@/lib/board/push-client'
import type { Board } from '@/lib/board/types'

// The head of a board page: one bar — back to the Kita, the Kita's and the
// board's name, the bell — that sticks to the top while the notes scroll, on
// screens tall enough to spare it (`tall`, src/styles/frontend.css). It
// sticks within BoardApp's wrapper, to the end of the notes.
const props = defineProps<{
  board: Board
  pushState: PushState
  bell: BellState
}>()

const emit = defineEmits<{ toggleBell: [] }>()

const kitaHref = computed(() => kitaPath(props.board.kitaToken))
const backLabel = computed(() => `Alle Bretter · ${props.board.kitaName}`)

// Without push here, the bell's place opens the reason instead
const hintLabel = computed(() => {
  if (props.pushState === 'install') return 'Benachrichtigungen einrichten'
  if (props.pushState === 'blocked') return 'Benachrichtigungen sind blockiert'
  return null
})
const hintId = useId()
const hintOpen = ref(false)
const hintButton = useTemplateRef<HTMLButtonElement>('hintButton')

// Only where the focus was lost: the visitor may have moved on meanwhile
function focusHint() {
  const focused = document.activeElement
  if (!focused || focused === document.body) hintButton.value?.focus()
}

// The visitor just refused the prompt: the bell they pressed is gone, so its
// place opens with the reason and takes the focus. Any other change, the
// first state after mounting included, leaves the hint as it is.
watch(
  () => props.pushState,
  (state, previous) => {
    if (previous !== 'ready' || state !== 'blocked') return
    hintOpen.value = true
    void nextTick(focusHint)
  },
)

// What gets the focus scrolls clear of the bar while it sticks
// (scroll-padding in src/styles/frontend.css). How high it is depends on how
// many lines the board's name takes.
const bar = useTemplateRef<HTMLElement>('bar')
let barHeight = -1
// The observer also fires for every change of the width: the root's style is
// only touched when the height is another one
useResizeObserver(bar, () => {
  const height = bar.value?.offsetHeight ?? 0
  if (height === barHeight) return
  barHeight = height
  document.documentElement.style.setProperty(
    '--sticky-bar-height',
    `${height}px`,
  )
})
</script>

<template>
  <!-- Above the notes, which tilt and so stack on their own; the felt keeps
       them from showing through -->
  <header
    ref="bar"
    data-sticky-bar
    class="bg-filz-texture tall:sticky tall:top-0 z-20 shadow-[0_1px_0_rgb(34_48_74/0.12)]"
  >
    <div class="mx-auto max-w-6xl px-4 py-2 sm:px-6 sm:py-3">
      <div class="flex items-center gap-2.5 sm:gap-3.5">
        <!-- Back to every board of the Kita: the page the app starts on -->
        <a
          :href="kitaHref"
          :aria-label="backLabel"
          :title="backLabel"
          class="text-tinte bg-white/60 hover:bg-white"
          :class="roundButtonClass"
        >
          <ArrowLeft class="size-5" aria-hidden="true" />
        </a>
        <div class="min-w-0 flex-1">
          <!-- /80: any lighter fails on the felt -->
          <p
            class="text-tinte/80 truncate text-[0.8125rem] leading-[1.3] font-semibold sm:text-[0.9375rem]"
          >
            {{ board.kitaName }}
          </p>
          <!-- Wraps rather than cutting the name off; Playwrite needs the
               generous line height -->
          <h1
            class="font-display text-tinte text-[1.3125rem] leading-[1.4] wrap-anywhere hyphens-auto sm:text-[2rem]"
          >
            {{ board.name }}
          </h1>
        </div>
        <PushBell
          v-if="pushState === 'ready'"
          :board-name="board.name"
          v-bind="bell"
          @toggle="emit('toggleBell')"
        />
        <!-- Round on phones and labelled from sm, like the bell. /60: the
             dashed rim keeps 3:1 against the felt. -->
        <button
          v-else-if="hintLabel"
          ref="hintButton"
          type="button"
          :aria-expanded="hintOpen"
          :aria-controls="hintId"
          :aria-label="hintLabel"
          :title="hintLabel"
          class="border-tinte/60 hover:bg-tinte/5 gap-2 border-2 border-dashed text-sm font-semibold aria-expanded:bg-white/60 sm:w-auto sm:px-4"
          :class="roundButtonClass"
          @click="hintOpen = !hintOpen"
        >
          <component
            :is="pushState === 'install' ? Bell : BellOff"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="max-sm:hidden">{{ hintLabel }}</span>
        </button>
      </div>
      <BoardAlert class="mt-2 max-w-md text-sm" :message="bell.error" />
      <div
        v-if="hintLabel"
        :id="hintId"
        :hidden="!hintOpen"
        class="mt-2 w-fit max-w-full rounded-2xl bg-white/60 px-3 py-2.5"
      >
        <PushHint :state="pushState" :kita-href="kitaHref" />
      </div>
    </div>
  </header>
</template>
