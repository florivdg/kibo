<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import { actions } from 'astro:actions'

import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import LinkShareCard from '@/components/admin/boards/LinkShareCard.vue'
import { Button } from '@/components/ui/button'
import { useAdminAction } from '@/composables/use-admin-action'

const props = defineProps<{
  url: string
  kitaName: string
  // The instance sends notifications, which a renewal ends as well
  push: boolean
  // The Kita is paused on the hosted instance: the link can't be renewed
  paused?: boolean
}>()

const { pending, run } = useAdminAction()

const renewDescription = `Alle bisherigen Links, QR-Codes und Symbole auf dem Home-Bildschirm der Kita funktionieren danach nicht mehr${props.push ? ', und alle Benachrichtigungen enden' : ''}. Das gilt auch für die Links zu einzelnen Brettern. Alle Zettel bleiben erhalten. Sinnvoll, wenn der Link in falsche Hände geraten ist.`

async function renewLink() {
  await run(() => actions.boards.renewKitaLink(), {
    leave: { reload: true, toast: 'Der neue Link gilt ab sofort.' },
  })
}
</script>

<template>
  <LinkShareCard
    title="Kita-Link"
    description="Wer diesen Link hat, sieht alle Bretter der Kita und kann Zettel anpinnen. Teilen Sie ihn zum Beispiel über die Kita-App oder als ausgedruckten QR-Code. Eltern können ihn einmal zum Home-Bildschirm hinzufügen."
    :url="url"
    :name="kitaName"
    open-label="Kita-Seite öffnen"
  >
    <template #actions>
      <ConfirmDialog
        title="Neuen Link erzeugen?"
        :description="renewDescription"
        confirm-label="Neuen Link erzeugen"
        @confirm="renewLink"
      >
        <Button variant="ghost" size="sm" :disabled="pending || paused">
          <RefreshCw />
          Neuen Link erzeugen
        </Button>
      </ConfirmDialog>
    </template>
  </LinkShareCard>
</template>
