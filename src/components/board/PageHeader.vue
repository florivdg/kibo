<script setup lang="ts">
// The head of the Kita page (a board page has its bar, BoardHeader.vue): the
// line above the title (`eyebrow`), the title and its description, then
// whatever the page adds below — the push hint
defineProps<{ title: string; description: string }>()
</script>

<template>
  <header class="mx-auto max-w-6xl px-4 pt-8 pb-6 sm:px-6 sm:pt-14 sm:pb-8">
    <div class="flex items-start justify-between gap-6">
      <slot name="eyebrow" />
      <!-- The boards belong to the Kita, so the platform stays in the corner -->
      <img
        src="/logo.svg"
        alt="Kibo"
        width="224"
        height="64"
        class="mt-0.5 h-5 w-auto shrink-0 opacity-45 sm:h-6"
      />
    </div>
    <h1
      class="font-display text-tinte mt-2 text-5xl leading-[1.35] wrap-anywhere hyphens-auto sm:text-7xl sm:leading-[1.3]"
    >
      {{ title }}
    </h1>
    <p
      class="text-tinte/80 mt-3 max-w-[38rem] text-lg leading-relaxed wrap-anywhere"
    >
      {{ description }}
    </p>
    <slot />
  </header>
</template>
