<script setup lang="ts">
import { actions } from 'astro:actions'

import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import CardHeading from '@/components/admin/CardHeading.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { useAdminAction } from '@/composables/use-admin-action'

// The two ways to close an open case (reports.close): with the note taken
// down in the same step, or with it left on the board. A note that hangs no
// more leaves only the second, worded for what is left to do.
const props = defineProps<{
  caseId: string
  noteTitle: string
  // Still on the board: not taken down, not run out
  hanging: boolean
}>()

const { pending, run } = useAdminAction()

function close(removeNote: boolean) {
  return run(
    () => actions.reports.close({ caseId: props.caseId, removeNote }),
    {
      // Said as it went: a note that was gone already wasn't removed
      leave: ({ data }) => ({
        reload: true,
        toast: data?.noteRemoved
          ? 'Der Zettel wurde entfernt und der Fall abgeschlossen.'
          : 'Der Fall wurde abgeschlossen.',
      }),
    },
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading>Entscheidung</CardHeading>
      <CardDescription>
        {{
          hanging
            ? 'Prüfen Sie den Zettel und die Hinweise. Bleibt der Zettel hängen, schließen Sie den Fall ohne Entfernung ab.'
            : 'Der Zettel hängt nicht mehr auf dem Brett. Es bleibt nur, den Fall abzuschließen.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-wrap gap-3">
      <ConfirmDialog
        v-if="hanging"
        title="Zettel entfernen?"
        :description="`„${noteTitle}“ wird sofort vom Brett genommen und gelöscht, der Fall wird abgeschlossen. Die Kopie im Fall bleibt bis zu seiner Löschung erhalten.`"
        confirm-label="Entfernen und abschließen"
        :pending="pending"
        @confirm="close(true)"
      >
        <Button
          variant="destructive"
          class="aria-disabled:opacity-50"
          :aria-disabled="pending"
        >
          Zettel entfernen und Fall abschließen
        </Button>
      </ConfirmDialog>
      <Button
        variant="outline"
        class="aria-disabled:opacity-50"
        :aria-disabled="pending"
        @click="close(false)"
      >
        {{ hanging ? 'Ohne Entfernung abschließen' : 'Fall abschließen' }}
      </Button>
    </CardContent>
  </Card>
</template>
