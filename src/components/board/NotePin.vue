<script setup lang="ts">
defineProps<{ color: string }>()
</script>

<template>
  <span
    aria-hidden="true"
    class="absolute top-2.5 left-1/2 size-4 -translate-x-1/2 rounded-full shadow-[inset_-2px_-3px_0_rgb(0_0_0/0.22),0_3px_4px_-1px_rgb(34_48_74/0.45)]"
    :class="color"
  />
</template>
