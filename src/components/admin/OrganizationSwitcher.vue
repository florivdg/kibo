<script setup lang="ts">
import { Building2, Check, ChevronsUpDown, Plus } from '@lucide/vue'
import { computed } from 'vue'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAdminAction } from '@/composables/use-admin-action'
import { authClient } from '@/lib/auth-client'

// Mirrors the better-auth organization plugin shape
export interface Organization {
  id: string
  name: string
  slug: string
  logo?: string | null
}

const props = defineProps<{
  organizations: Organization[]
  activeOrganizationId?: string
}>()

const { isMobile } = useSidebar()
const { run } = useAdminAction()

const activeOrganization = computed(() =>
  props.organizations.find((org) => org.id === props.activeOrganizationId),
)

async function selectOrganization(organization: Organization) {
  if (organization.id === props.activeOrganizationId) return
  // Server-rendered admin data is scoped to the active organization
  await run(
    () =>
      authClient.organization.setActive({ organizationId: organization.id }),
    { leave: { reload: true } },
  )
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <!-- Kitas have no logo of their own yet, so the slot carries the
                 Kibo mark until one is set -->
            <div
              class="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
              :class="
                activeOrganization?.logo &&
                'bg-sidebar-primary text-sidebar-primary-foreground'
              "
            >
              <img
                v-if="activeOrganization?.logo"
                :src="activeOrganization.logo"
                :alt="activeOrganization.name"
                class="size-full object-cover"
              />
              <img v-else src="/logo-mark.svg" alt="Kibo" class="size-full" />
            </div>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">
                {{ activeOrganization?.name ?? 'Keine Kita' }}
              </span>
              <span class="truncate text-xs">Administration</span>
            </div>
            <!-- The collapsed rail is only wide enough for the mark itself -->
            <ChevronsUpDown
              class="ml-auto group-data-[collapsible=icon]:hidden"
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-(--reka-dropdown-menu-trigger-width) min-w-56 rounded-lg"
          align="start"
          :side="isMobile ? 'bottom' : 'right'"
          :side-offset="4"
        >
          <DropdownMenuLabel class="text-xs text-muted-foreground">
            Kitas
          </DropdownMenuLabel>
          <DropdownMenuItem
            v-for="organization in organizations"
            :key="organization.id"
            class="gap-2 p-2"
            :aria-current="
              organization.id === activeOrganizationId ? 'true' : undefined
            "
            @click="selectOrganization(organization)"
          >
            <div
              class="flex size-6 items-center justify-center overflow-hidden rounded-sm border"
            >
              <img
                v-if="organization.logo"
                :src="organization.logo"
                :alt="organization.name"
                class="size-full object-cover"
              />
              <Building2 v-else class="size-3.5 shrink-0" />
            </div>
            <span class="flex-1 truncate">{{ organization.name }}</span>
            <template v-if="organization.id === activeOrganizationId">
              <Check class="ml-auto size-4" />
              <span class="sr-only">(aktiv)</span>
            </template>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="gap-2 p-2"
            as="a"
            href="/admin/organizations/new"
          >
            <div
              class="flex size-6 items-center justify-center rounded-md border bg-transparent"
            >
              <Plus class="size-4" />
            </div>
            <div class="font-medium text-muted-foreground">Kita anlegen</div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
