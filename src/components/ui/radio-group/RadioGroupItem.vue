<script setup lang="ts">
import type { RadioGroupItemProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { CircleIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { RadioGroupIndicator, RadioGroupItem, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<
  RadioGroupItemProps & { class?: HTMLAttributes['class'] }
>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RadioGroupItem
    data-slot="radio-group-item"
    v-bind="forwardedProps"
    :class="
      cn(
        'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary',
        props.class,
      )
    "
  >
    <RadioGroupIndicator
      data-slot="radio-group-indicator"
      class="flex size-4 items-center justify-center"
    >
      <slot>
        <CircleIcon
          class="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground"
        />
      </slot>
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
