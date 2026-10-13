<script setup lang="ts">
import { CircleAlert } from '@lucide/vue'

import { Alert, AlertDescription } from '@/components/ui/alert'

// `id`: for a field the error is about, which points at it with
// aria-describedby (fieldAria in src/lib/field-aria.ts)
defineProps<{ message: string | null; id?: string }>()
</script>

<template>
  <Alert v-if="message" :id="id" variant="destructive">
    <CircleAlert />
    <AlertDescription>{{ message }}</AlertDescription>
  </Alert>
</template>
