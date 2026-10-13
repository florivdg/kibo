<script setup lang="ts">
import BoardAlert from '@/components/board/BoardAlert.vue'
import EmptyState from '@/components/board/EmptyState.vue'
import PageHeader from '@/components/board/PageHeader.vue'
import PushBell from '@/components/board/PushBell.vue'
import PushHint from '@/components/board/PushHint.vue'
import { useAppBadge } from '@/composables/use-app-badge'
import { usePushBells } from '@/composables/use-push-bells'
import { useSeenBoards } from '@/composables/use-seen-boards'
import { kitaBoardPath } from '@/lib/board/paths'
import type { KitaBoard } from '@/lib/board/types'

// The Kita page /k/<token>/: every board of the Kita, and the bells to be
// notified about each. What the installed app opens on.
const props = defineProps<{
  kita: { token: string; name: string; pushPublicKey: string | null }
  boards: KitaBoard[]
}>()

const {
  state: pushState,
  status: pushStatus,
  bell,
  toggle: toggleBell,
} = usePushBells(props.kita.token, props.kita.pushPublicKey, {
  onUnseen: useAppBadge().show,
})
const seen = useSeenBoards()

function noteCountLabel(count: number) {
  if (count === 0) return 'Noch keine Zettel'
  return count === 1 ? '1 Zettel' : `${count} Zettel`
}
</script>

<template>
  <div class="flex-1">
    <PageHeader
      :title="kita.name"
      description="Alle Bretter eurer Kita. Tipp auf ein Brett, um die Zettel zu sehen und selbst einen anzupinnen."
    >
      <template #eyebrow>
        <p class="text-tinte/80 min-w-0 text-base font-semibold">Bretter</p>
      </template>
      <PushHint class="mt-5" :state="pushState" />
    </PageHeader>

    <main class="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <ul v-if="boards.length" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li
          v-for="board in boards"
          :key="board.id"
          class="relative grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-3 rounded-[1.5rem_1.1rem_1.7rem_1.2rem] bg-white/75 px-5 py-5 wrap-anywhere shadow-[0_10px_20px_-14px_rgb(34_48_74/0.6)] focus-within:bg-white hover:bg-white"
        >
          <div class="min-w-0">
            <h2 class="text-xl leading-snug font-bold text-balance">
              <!-- The stretched link makes the whole card clickable; the
                   count and the „Neu“ below describe it, so a screen reader
                   hears them with the board's name -->
              <a
                :href="kitaBoardPath(kita.token, board.id)"
                :aria-describedby="`board-${board.id}-notes`"
                class="after:focus-visible:outline-tinte after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none after:focus-visible:outline-3 after:focus-visible:outline-offset-4"
              >
                {{ board.name }}
              </a>
            </h2>
            <p
              v-if="board.description"
              class="text-tinte/80 mt-1 line-clamp-2 leading-relaxed"
            >
              {{ board.description }}
            </p>
            <p
              :id="`board-${board.id}-notes`"
              class="text-tinte/80 mt-3 flex items-center gap-2 text-sm"
            >
              <span>{{ noteCountLabel(board.noteCount) }}</span>
              <span
                v-if="seen.hasNews(board.id, board.latestNoteAt)"
                class="bg-kirsche rounded-full px-2 py-0.5 text-xs font-bold text-white"
                title="Neue Zettel seit deinem letzten Besuch"
              >
                Neu
              </span>
            </p>
          </div>
          <template v-if="pushState === 'ready' && board.pushEnabled">
            <!-- Lifted above the card's stretched link, so a tap doesn't
                 open the board -->
            <PushBell
              compact
              class="relative z-10"
              :board-name="board.name"
              v-bind="bell(board.id)"
              @toggle="toggleBell(board.id, board.name)"
            />
            <BoardAlert
              class="relative z-10 col-span-full text-sm"
              :message="bell(board.id).error"
            />
          </template>
        </li>
      </ul>
      <EmptyState
        v-else
        class="mt-4"
        title="Hier hängt noch kein Brett."
        hint="Sobald die Kita ein Brett anlegt, erscheint es hier."
      />
      <p role="status" class="sr-only">{{ pushStatus }}</p>
    </main>
  </div>
</template>
