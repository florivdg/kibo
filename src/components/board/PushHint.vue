<script setup lang="ts">
import { Bell, BellOff } from '@lucide/vue'

import type { PushState } from '@/lib/board/push-client'

// Shown once per page instead of the bells, when they can't be used here.
// `kitaHref`: on a board page, the Kita page — the one to add to the home
// screen, since the app opens there.
defineProps<{ state: PushState; kitaHref?: string }>()
</script>

<template>
  <p
    v-if="state === 'install' || state === 'blocked'"
    class="text-tinte/80 flex max-w-md items-start gap-2 text-sm leading-relaxed"
  >
    <component
      :is="state === 'install' ? Bell : BellOff"
      class="mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <span v-if="state === 'blocked'">
      Benachrichtigungen sind blockiert. Du kannst sie in den Einstellungen
      wieder erlauben.
    </span>
    <span v-else-if="kitaHref">
      Benachrichtigungen bei neuen Zetteln: Öffne
      <a :href="kitaHref" class="font-semibold underline underline-offset-3"
        >alle Bretter</a
      >, tippe auf Teilen → „Zum Home-Bildschirm“ und schalte dort die Glocken
      ein.
    </span>
    <span v-else>
      Benachrichtigungen bei neuen Zetteln: Teilen → „Zum Home-Bildschirm“, dann
      dort bei den Brettern die Glocke antippen.
    </span>
  </p>
</template>
