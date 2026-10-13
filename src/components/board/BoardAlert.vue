<script setup lang="ts">
defineProps<{ message: string | null }>()
</script>

<template>
  <p
    v-if="message"
    role="alert"
    class="border-kirsche bg-kirsche/10 rounded-2xl border-2 px-4 py-3 font-semibold"
  >
    {{ message }}
  </p>
</template>
