<script setup lang="ts">
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'

defineProps<{ id: string }>()
const emit = defineEmits<{ complete: [] }>()
const code = defineModel<string>({ required: true })
</script>

<template>
  <InputOTP
    :id="id"
    v-model="code"
    :maxlength="6"
    autocomplete="one-time-code"
    inputmode="numeric"
    @complete="emit('complete')"
  >
    <InputOTPGroup>
      <InputOTPSlot v-for="index in 6" :key="index" :index="index - 1" />
    </InputOTPGroup>
  </InputOTP>
</template>
