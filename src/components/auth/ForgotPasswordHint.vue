<script setup lang="ts">
import { FORGOT_PASSWORD_PATH } from '@/lib/auth-paths'

// Points an account that has no password yet to "Passwort vergessen", which
// sets the first one too. `lead` is the sentence before it.
defineProps<{ lead: string }>()
</script>

<template>
  <p class="text-center text-sm text-muted-foreground">
    {{ lead }} Fordern Sie über
    <a :href="FORGOT_PASSWORD_PATH" class="underline underline-offset-4"
      >„Passwort vergessen“</a
    >
    einen Link an.
  </p>
</template>
