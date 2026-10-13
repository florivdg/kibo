<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'
import type { Organization } from '@/components/admin/OrganizationSwitcher.vue'

import {
  CircleHelp,
  Flag,
  LayoutDashboard,
  Receipt,
  Settings,
  StickyNote,
} from '@lucide/vue'
import { computed } from 'vue'

import NavMain from '@/components/admin/NavMain.vue'
import NavUser from '@/components/admin/NavUser.vue'
import OrganizationSwitcher from '@/components/admin/OrganizationSwitcher.vue'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { adminNavigation, type AdminNavId } from '@/lib/admin-nav'

const props = withDefaults(
  defineProps<
    SidebarProps & {
      currentPath: string
      organizations: Organization[]
      activeOrganizationId?: string
      user: { name: string; email: string; avatar: string }
      // The documentation: the instance's own /docs or an external address
      docsHref: string
      // The hosted instance has a subscription page
      hosted: boolean
      // Reported notes of the active Kita that wait for someone
      openReports?: number
    }
  >(),
  {
    collapsible: 'icon',
  },
)

const ICONS: Record<AdminNavId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  boards: StickyNote,
  reports: Flag,
  kita: Settings,
  subscription: Receipt,
}

const navMain = computed(() =>
  adminNavigation(props.currentPath, props).map((item) => ({
    ...item,
    icon: ICONS[item.id],
    badge: item.id === 'reports' ? props.openReports || undefined : undefined,
  })),
)

// Always a new window, so a form somebody is filling in stays where it is
const navHelp = computed(() => [
  { title: 'Hilfe', url: props.docsHref, icon: CircleHelp, external: true },
])
</script>

<template>
  <Sidebar :side="side" :variant="variant" :collapsible="collapsible">
    <SidebarHeader>
      <OrganizationSwitcher
        :organizations="organizations"
        :active-organization-id="activeOrganizationId"
      />
    </SidebarHeader>
    <SidebarContent>
      <nav aria-label="Verwaltung">
        <NavMain label="Verwaltung" :items="navMain" />
      </nav>
      <!-- Out of the way at the bottom; a single link, no landmark of its own -->
      <NavMain class="mt-auto" :items="navHelp" />
    </SidebarContent>
    <SidebarFooter>
      <NavUser :user="user" />
    </SidebarFooter>
    <SidebarRail
      aria-label="Seitenleiste ein-/ausblenden"
      title="Seitenleiste ein-/ausblenden"
    />
  </Sidebar>
</template>
