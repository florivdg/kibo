<script setup lang="ts">
import { Download, ExternalLink } from '@lucide/vue'
import { computed } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import QrCode from '@/components/admin/QrCode.vue'
import CopyLinkButton from '@/components/admin/boards/CopyLinkButton.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { qrCodeSvg, qrCodeSvgFile } from '@/lib/qr-code'

// A public link to hand out: as text to copy, to open, and as a QR code to
// print. `name` names the QR code and its file; the `actions` slot takes
// more buttons next to copy and open (KitaLinkCard's renewal).
const props = defineProps<{
  title: string
  description: string
  url: string
  name: string
  openLabel: string
}>()

const qrCode = computed(() => qrCodeSvg(props.url))

const qrDownload = computed(() => ({
  href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCodeSvgFile(qrCode.value))}`,
  filename: `QR-Code ${props.name}.svg`,
}))
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading>{{ title }}</CardHeading>
      <CardDescription>{{ description }}</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-6 sm:grid-cols-[auto_1fr]">
      <div class="grid content-start gap-2">
        <QrCode
          :svg="qrCode"
          class="size-40"
          role="img"
          :aria-label="`QR-Code für ${name}`"
        />
        <Button variant="outline" size="sm" as-child>
          <a :href="qrDownload.href" :download="qrDownload.filename">
            <Download />
            QR-Code laden
          </a>
        </Button>
      </div>
      <div class="grid content-start gap-3">
        <Input
          :model-value="url"
          readonly
          :aria-label="title"
          class="font-mono"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <div class="flex flex-wrap gap-2">
          <CopyLinkButton :url="url" />
          <Button variant="outline" size="sm" as-child>
            <a :href="url" target="_blank" rel="noopener">
              <ExternalLink />
              {{ openLabel }}
              <span class="sr-only">(öffnet in neuem Fenster)</span>
            </a>
          </Button>
          <slot name="actions" />
        </div>
      </div>
    </CardContent>
  </Card>
</template>
