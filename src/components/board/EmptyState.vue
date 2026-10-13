<script setup lang="ts">
// The dashed box where the Kita page has no boards or a board no notes
defineProps<{ title: string; hint: string }>()
</script>

<template>
  <div
    class="border-tinte/25 max-w-md rounded-[1.5rem_1.1rem_1.7rem_1.2rem] border-2 border-dashed px-6 py-8"
  >
    <p class="text-lg font-semibold">{{ title }}</p>
    <p class="text-tinte/75 mt-1">{{ hint }}</p>
  </div>
</template>
