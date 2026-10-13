<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { refAutoReset } from '@vueuse/core'

import { toastError } from '@/components/admin/toast'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'

// `name` names the board where several buttons share a page; the accessible
// name starts with the visible text, so voice control finds it by that
const props = defineProps<{ url: string; name?: string }>()

const copied = refAutoReset(false, 2000)

async function copyUrl() {
  if (!(await copyText(props.url))) {
    toastError('Der Link konnte nicht kopiert werden.')
    return
  }
  copied.value = true
}
</script>

<template>
  <Button
    type="button"
    variant="outline"
    size="sm"
    :aria-label="name && !copied ? `Link kopieren: „${name}“` : undefined"
    @click="copyUrl"
  >
    <Check v-if="copied" />
    <Copy v-else />
    {{ copied ? 'Kopiert' : 'Link kopieren' }}
  </Button>
  <!-- The button's new text isn't announced while it has focus -->
  <span role="status" class="sr-only">{{ copied ? 'Link kopiert' : '' }}</span>
</template>
