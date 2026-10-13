<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue'

// The board's description below its bar. On a phone it is one line with an
// ellipsis, and only a line that is actually cut off gets a button for the
// rest; from sm it is shown in full. A screen reader hears all of it anyway.
defineProps<{ text: string }>()

const id = useId()
const row = useTemplateRef<HTMLElement>('row')
const paragraph = useTemplateRef<HTMLElement>('paragraph')
const probe = useTemplateRef<HTMLElement>('probe')
// Measured on the client only: the server renders it collapsed, without the
// button, and hydration matches
const clipped = ref(false)
const open = ref(false)

// The text on one line against the whole row (its box below), not against
// the paragraph: that one is narrowed by the button and wraps while open. So
// pressing the button never makes it go away under the focus.
function measure() {
  const line = probe.value
  if (line?.parentElement) {
    clipped.value =
      line.getBoundingClientRect().width > line.parentElement.clientWidth
  }
}

// The screen got wide enough: nothing left to open, so it is collapsed again
// for when the line gets too short later. A button that goes while it has
// the focus hands it to its text.
const button = useTemplateRef<HTMLButtonElement>('button')
watch(clipped, async (value) => {
  if (value) return
  open.value = false
  if (document.activeElement !== button.value) return
  await nextTick()
  paragraph.value?.focus()
})

useResizeObserver(row, measure)
// The web font changes the text's width, not the size of the line
onMounted(() => void document.fonts.ready.then(measure))

const textClass = 'text-[0.9375rem] leading-normal sm:text-[1.0625rem]'
</script>

<template>
  <div
    ref="row"
    class="relative mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mb-4"
  >
    <p
      :id="id"
      ref="paragraph"
      tabindex="-1"
      class="text-tinte/80 max-w-[38rem] min-w-0 flex-1 wrap-anywhere focus:outline-none"
      :class="[textClass, open ? 'basis-full' : 'max-sm:truncate']"
    >
      {{ text }}
    </p>
    <!-- The same text on one unbroken line, only to be measured, in a box as
         wide as the paragraph can get; clipped by it, so it can't widen the
         page -->
    <div
      aria-hidden="true"
      class="invisible absolute inset-x-0 top-0 h-0 max-w-[38rem] overflow-hidden"
    >
      <span ref="probe" class="whitespace-nowrap" :class="textClass">
        {{ text }}
      </span>
    </div>
    <!-- Negative margins: a 44 px target on a line half as high -->
    <button
      v-if="clipped"
      ref="button"
      type="button"
      :aria-expanded="open"
      :aria-controls="id"
      class="text-tinte focus-visible:outline-tinte -mx-2 -my-2.5 min-h-11 shrink-0 rounded-full px-2 text-[0.9375rem] font-semibold underline underline-offset-3 hover:no-underline focus-visible:outline-3 focus-visible:outline-offset-2 sm:hidden"
      @click="open = !open"
    >
      {{ open ? 'weniger' : 'mehr' }}
    </button>
  </div>
</template>
