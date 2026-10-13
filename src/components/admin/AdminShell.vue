<script setup lang="ts">
import type { Organization } from '@/components/admin/OrganizationSwitcher.vue'

import AppSidebar from '@/components/admin/AppSidebar.vue'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

defineProps<{
  currentPath: string
  breadcrumbs?: {
    label: string
    href?: string
  }[]
  sidebarOpen: boolean
  organizations: Organization[]
  activeOrganizationId?: string
  user: {
    name: string
    email: string
    avatar: string
  }
  docsHref: string
  hosted: boolean
  openReports?: number
}>()
</script>

<template>
  <SidebarProvider :default-open="sidebarOpen">
    <AppSidebar
      :current-path="currentPath"
      :organizations="organizations"
      :active-organization-id="activeOrganizationId"
      :user="user"
      :docs-href="docsHref"
      :hosted="hosted"
      :open-reports="openReports"
    />
    <!-- SidebarInset's box (for the default variant), but no <main> of its
         own: the main landmark holds the page alone, so the skip link of
         Admin.astro passes the header and the footer stays outside it -->
    <div
      data-slot="sidebar-inset"
      class="relative flex w-full flex-1 flex-col bg-background"
    >
      <header
        class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
      >
        <div class="flex items-center gap-2 px-4">
          <SidebarTrigger
            class="-ml-1"
            aria-label="Seitenleiste ein-/ausblenden"
          />
          <Separator
            orientation="vertical"
            class="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb aria-label="Navigationspfad">
            <BreadcrumbList>
              <BreadcrumbItem class="hidden md:block">
                <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
              </BreadcrumbItem>
              <template v-for="crumb in breadcrumbs" :key="crumb.label">
                <BreadcrumbSeparator class="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbLink v-if="crumb.href" :href="crumb.href">
                    {{ crumb.label }}
                  </BreadcrumbLink>
                  <BreadcrumbPage v-else>{{ crumb.label }}</BreadcrumbPage>
                </BreadcrumbItem>
              </template>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <main
        id="inhalt"
        tabindex="-1"
        class="flex flex-1 flex-col gap-4 p-4 pt-0 outline-none"
      >
        <slot />
      </main>
      <!-- Imprint and privacy policy, rendered on the server -->
      <slot name="footer" />
    </div>
  </SidebarProvider>
</template>
