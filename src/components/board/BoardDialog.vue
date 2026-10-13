<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'

// Native <dialog>: focus trapping, Escape and inert background for free.
// Slides up as a bottom sheet on phones, centered on larger screens.
const props = defineProps<{ open: boolean; labelledby: string }>()
// close asks the parent to close the dialog; closed follows once it has, with
// the focus back on the element that opened it
const emit = defineEmits<{ close: []; closed: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')

watch(
  () => props.open,
  (open) => {
    if (open) dialog.value?.showModal()
    else dialog.value?.close()
  },
  { flush: 'post' },
)

// Escape closes the dialog without asking, so the parent is told here as well
function onNativeClose() {
  emit('close')
  emit('closed')
}

// Only a click that also started on the backdrop closes the dialog, so
// selecting text in a field and letting go outside keeps it open
let pressedOnBackdrop = false

function onPointerDown(event: PointerEvent) {
  pressedOnBackdrop = event.target === dialog.value
}

function onBackdropClick(event: MouseEvent) {
  if (pressedOnBackdrop && event.target === dialog.value) emit('close')
  pressedOnBackdrop = false
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="labelledby"
    class="text-tinte backdrop:bg-tinte/45 mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[2rem] bg-white sm:m-auto sm:max-w-lg sm:rounded-[2rem]"
    @close="onNativeClose"
    @pointerdown="onPointerDown"
    @click="onBackdropClick"
  >
    <div
      class="px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-8"
    >
      <slot />
    </div>
  </dialog>
</template>
