<script setup lang="ts">
import { useTemplateRef, type HTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

// CardTitle as a real heading: the card's title is the h2 of its section (an
// h1 where the card is the page). The classes are CardTitle's own.
const props = withDefaults(
  defineProps<{ level?: 1 | 2; class?: HTMLAttributes['class'] }>(),
  { level: 2, class: undefined },
)

const heading = useTemplateRef<HTMLHeadingElement>('heading')

// For a heading that takes the focus (tabindex="-1"), e.g. once the last row
// of its table is gone
defineExpose({ focus: () => heading.value?.focus() })
</script>

<template>
  <component
    :is="`h${level}`"
    ref="heading"
    data-slot="card-title"
    :class="
      cn(
        'cn-font-heading text-base leading-normal font-medium group-data-[size=sm]/card:text-sm',
        props.class,
      )
    "
  >
    <slot />
  </component>
</template>
