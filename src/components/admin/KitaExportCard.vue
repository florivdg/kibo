<script setup lang="ts">
import { Download } from '@lucide/vue'
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import { toastError } from '@/components/admin/toast'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { downloadKitaExport } from '@/lib/board/kita-export-client'

const pending = ref(false)

async function download() {
  pending.value = true
  try {
    const refusal = await downloadKitaExport()
    if (refusal) toastError(refusal)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Daten exportieren</CardHeading>
      <CardDescription>
        Alle Bretter der Kita mit ihren Einstellungen und alle aktuellen Zettel
        als eine JSON-Datei – zum Aufbewahren oder für den Umzug auf eine andere
        Kibo-Instanz. Abgelaufene Zettel, Meldungen und das Team sind nicht
        enthalten.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Button variant="outline" :disabled="pending" @click="download">
        <Download />
        Daten herunterladen
      </Button>
    </CardContent>
  </Card>
</template>
