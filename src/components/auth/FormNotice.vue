<script setup lang="ts">
import { CircleCheck } from '@lucide/vue'

import { Alert, AlertDescription } from '@/components/ui/alert'

defineProps<{ message: string | null }>()
</script>

<template>
  <Alert v-if="message">
    <CircleCheck />
    <AlertDescription>{{ message }}</AlertDescription>
  </Alert>
</template>
