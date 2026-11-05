<script setup lang="ts">
import { onBeforeMount, watch } from 'vue'

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'

const CODE_LENGTH = 6

defineProps<{ id: string }>()
const emit = defineEmits<{ complete: [] }>()
const code = defineModel<string>({ required: true })

// Complete only on the step from fewer digits to all six. vue-input-otp's own
// complete event compares against a previous value that moves only when the
// value does, so it fires again whenever the input re-renders with six
// digits: a failed check re-rendered it and sent the same code again, in a
// loop until the rate limit answered.
watch(code, (value, previous) => {
  if (value.length === CODE_LENGTH && (previous ?? '').length < CODE_LENGTH) {
    emit('complete')
  }
})

// vue-input-otp adds its few rules in a <style> element it creates, which
// the page CSP refuses (it allows hashes, and the library only knows nonces).
// The rules are in the style block below instead; an element with the id it
// looks for keeps it from trying. Before mount, so it's there before the
// library's own onMounted.
onBeforeMount(() => {
  if (document.getElementById('input-otp-style')) return
  const marker = document.createElement('meta')
  marker.id = 'input-otp-style'
  document.head.append(marker)
})
</script>

<template>
  <InputOTP
    :id="id"
    v-model="code"
    :maxlength="CODE_LENGTH"
    autocomplete="one-time-code"
    inputmode="numeric"
  >
    <InputOTPGroup>
      <InputOTPSlot
        v-for="index in CODE_LENGTH"
        :key="index"
        :index="index - 1"
      />
    </InputOTPGroup>
  </InputOTP>
</template>

<style>
/* The rules vue-input-otp 0.4 would inject: the real input lies transparent
   over the six slots, so neither its selection nor the browser's autofill
   colours may show, and iOS needs its text squeezed to keep the caret in
   place */
[data-input-otp]::selection {
  background: transparent !important;
  color: transparent !important;
}

/* Separate rules: a browser drops a whole list for one selector it doesn't
   know */
[data-input-otp]:autofill {
  background: transparent !important;
  color: transparent !important;
  border-color: transparent !important;
  opacity: 0 !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  -webkit-text-fill-color: transparent !important;
}

[data-input-otp]:-webkit-autofill {
  background: transparent !important;
  color: transparent !important;
  border-color: transparent !important;
  opacity: 0 !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  -webkit-text-fill-color: transparent !important;
}

@supports (-webkit-touch-callout: none) {
  [data-input-otp] {
    letter-spacing: -0.6em !important;
    font-weight: 100 !important;
    font-stretch: ultra-condensed;
    font-optical-sizing: none !important;
    left: -1px !important;
    right: 1px !important;
  }
}

[data-input-otp] + * {
  pointer-events: all !important;
}
</style>
