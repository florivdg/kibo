<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { actions } from 'astro:actions'
import { computed, nextTick, useTemplateRef } from 'vue'
import { toast } from 'vue-sonner'

import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import CardHeading from '@/components/admin/CardHeading.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAdminAction } from '@/composables/use-admin-action'
import { useNotePager } from '@/composables/use-note-pager'
import {
  neighbourAfterRemoval,
  restoreFocusAfterRemoval,
} from '@/lib/board/focus-after-removal'
import type {
  BoardCategory,
  Note,
  NoteCursor,
  NotePage,
} from '@/lib/board/types'

const props = defineProps<{
  boardId: string
  initial: NotePage
  categories: BoardCategory[]
}>()

const heading = useTemplateRef<InstanceType<typeof CardHeading>>('heading')
const { pending, run } = useAdminAction()
const { notes, hasMore, status, statusRef, loadMore } = useNotePager(
  (cursor?: NoteCursor) =>
    actions.boards.listNotes({ id: props.boardId, cursor }),
  props.initial,
)

const categoryLabels = computed(
  () => new Map(props.categories.map(({ id, label }) => [id, label])),
)

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
})

function formatDate(value: string) {
  return dateFormat.format(new Date(value))
}

function removeButtonId(noteId: string) {
  return `remove-note-${noteId}`
}

function removeButton(noteId: string | null) {
  if (!noteId) return null
  return document.getElementById(removeButtonId(noteId))
}

async function remove(note: Note) {
  if (pending.value) return
  const trigger = removeButton(note.id)
  const ok = await run(() => actions.boards.removeNote({ noteId: note.id }))
  if (!ok) return
  // The row takes the focused button with it: on to the next row's button,
  // the previous one's, or the heading once the table is empty
  const neighbour = neighbourAfterRemoval(
    notes.value.map(({ id }) => id),
    note.id,
  )
  notes.value = notes.value.filter(({ id }) => id !== note.id)
  toast.success(`„${note.title}“ wurde entfernt.`)
  await nextTick()
  restoreFocusAfterRemoval(
    trigger,
    removeButton(neighbour),
    document,
    heading.value,
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading ref="heading" tabindex="-1" class="outline-none">
        Zettel
      </CardHeading>
      <CardDescription>
        {{
          notes.length === 1
            ? '1 Zettel hängt gerade.'
            : `${notes.length}${hasMore ? '+' : ''} Zettel hängen gerade.`
        }}
        Abgelaufene Zettel verschwinden automatisch.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Table v-if="notes.length">
        <TableCaption class="sr-only">Zettel auf diesem Brett</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Zettel</TableHead>
            <TableHead class="hidden md:table-cell">Von</TableHead>
            <TableHead class="hidden sm:table-cell">Angepinnt</TableHead>
            <TableHead class="hidden sm:table-cell">Läuft ab</TableHead>
            <TableHead class="w-0"
              ><span class="sr-only">Aktionen</span></TableHead
            >
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="note in notes" :key="note.id">
            <TableCell class="max-w-72 whitespace-normal">
              <Badge variant="secondary">
                {{ categoryLabels.get(note.categoryId) ?? note.categoryId }}
              </Badge>
              <p class="mt-1 font-medium">{{ note.title }}</p>
              <p class="line-clamp-2 text-muted-foreground">{{ note.body }}</p>
            </TableCell>
            <TableCell class="hidden md:table-cell">{{
              note.author
            }}</TableCell>
            <TableCell class="hidden sm:table-cell">
              {{ formatDate(note.createdAt) }}
            </TableCell>
            <TableCell class="hidden sm:table-cell">
              {{ formatDate(note.expiresAt) }}
            </TableCell>
            <TableCell>
              <ConfirmDialog
                title="Zettel entfernen?"
                :description="`„${note.title}“ wird sofort vom Brett genommen und gelöscht.`"
                confirm-label="Entfernen"
                :pending="pending"
                @confirm="remove(note)"
              >
                <Button
                  :id="removeButtonId(note.id)"
                  variant="ghost"
                  size="icon-sm"
                  class="aria-disabled:opacity-50"
                  :aria-disabled="pending"
                  :aria-label="`„${note.title}“ entfernen`"
                >
                  <Trash2 />
                </Button>
              </ConfirmDialog>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p v-else-if="!hasMore" class="text-sm text-muted-foreground">
        Noch keine Zettel. Sobald jemand über den Link etwas anpinnt, erscheint
        es hier.
      </p>
      <Button
        v-if="hasMore"
        class="mt-4 aria-disabled:opacity-50"
        variant="outline"
        :aria-disabled="pending"
        @click="run(loadMore)"
      >
        Ältere Zettel laden
      </Button>
      <p ref="statusRef" tabindex="-1" role="status" class="sr-only">
        {{ status }}
      </p>
    </CardContent>
  </Card>
</template>
