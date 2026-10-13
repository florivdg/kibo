<script setup lang="ts">
// Size it with a class; the white box keeps dark mode from eating the quiet zone
defineProps<{ svg: string }>()
</script>

<template>
  <div class="overflow-hidden rounded-md bg-white" v-html="svg" />
</template>
