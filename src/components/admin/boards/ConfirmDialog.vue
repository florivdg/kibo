<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Asks before an action that can't be undone. The trigger goes in the slot;
// without one, the caller opens the dialog through v-model:open, e.g. after a
// form passed its own validation.
const props = defineProps<{
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ confirm: [] }>()

function updateOpen(value: boolean) {
  // Pending triggers stay focusable, but cannot open another confirmation.
  if (value && props.pending) return
  open.value = value
}

function confirm() {
  if (!props.pending) emit('confirm')
}
</script>

<template>
  <AlertDialog :open="open" @update:open="updateOpen">
    <AlertDialogTrigger v-if="$slots.default" as-child>
      <slot />
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>{{ description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          class="aria-disabled:opacity-50"
          :aria-disabled="pending"
          @click="confirm"
        >
          {{ confirmLabel }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
