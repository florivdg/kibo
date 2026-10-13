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

const props = defineProps<{
  boardId: string
  name: string
  // The Kita is paused on the hosted instance: nothing here can be changed
  paused?: boolean
}>()

const { pending, run } = useAdminAction()

async function remove() {
  await run(() => actions.boards.remove({ id: props.boardId }), {
    leave: { href: '/admin/boards', toast: `„${props.name}“ wurde gelöscht.` },
  })
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading>Brett löschen</CardHeading>
      <CardDescription>
        Das Brett und alle Zettel werden endgültig gelöscht. Der Link
        funktioniert danach nicht mehr.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ConfirmDialog
        :title="`„${name}“ löschen?`"
        description="Das Brett und alle Zettel darauf werden endgültig gelöscht. Das lässt sich nicht rückgängig machen."
        confirm-label="Endgültig löschen"
        @confirm="remove"
      >
        <Button variant="destructive" :disabled="pending || paused">
          Brett löschen
        </Button>
      </ConfirmDialog>
    </CardContent>
  </Card>
</template>
