<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

defineProps<{
  label?: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    // aria-current: the page itself, or a page within its section
    current?: 'page' | 'true'
    // Opens in a new window, and says so
    external?: boolean
    // A count next to the title, e.g. of open reports
    badge?: number
  }[]
}>()

const NEW_WINDOW = '(öffnet in neuem Fenster)'
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel v-if="label">{{ label }}</SidebarGroupLabel>
    <SidebarMenu>
      <SidebarMenuItem v-for="item in items" :key="item.title">
        <SidebarMenuButton
          as-child
          :tooltip="item.external ? `${item.title} ${NEW_WINDOW}` : item.title"
          :is-active="!!item.current"
        >
          <a
            :href="item.url"
            :target="item.external ? '_blank' : undefined"
            :rel="item.external ? 'noopener' : undefined"
            :aria-current="item.current"
          >
            <component :is="item.icon" v-if="item.icon" />
            <span v-if="item.external">
              {{ item.title }}
              <span class="sr-only">{{ NEW_WINDOW }}</span>
            </span>
            <span v-else>{{ item.title }}</span>
          </a>
        </SidebarMenuButton>
        <SidebarMenuBadge v-if="item.badge">
          {{ item.badge }}<span class="sr-only"> offen</span>
        </SidebarMenuBadge>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarGroup>
</template>
