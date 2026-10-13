<script setup lang="ts">
import { onMounted } from 'vue'
import { toast } from 'vue-sonner'

import { Toaster } from '@/components/ui/sonner'
import { takeNextPageToast } from '@/composables/use-form-submit'

// The Toaster only shows toasts raised after it subscribed, so the message
// left by the previous page waits for it to mount
onMounted(() => {
  const message = takeNextPageToast()
  if (message) toast.success(message)
})

// The wrapper replaces its default toast options wholesale when given any, so
// they are repeated here next to the German name of the close button (error
// toasts carry one, toastError in toast.ts)
const toastOptions = {
  classes: { toast: 'rounded-2xl' },
  closeButtonAriaLabel: 'Benachrichtigung schließen',
}
</script>

<template>
  <Toaster
    container-aria-label="Benachrichtigungen"
    :toast-options="toastOptions"
  />
</template>
