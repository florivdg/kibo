<script setup lang="ts">
import { actions } from 'astro:actions'
import { computed, ref, useId } from 'vue'

import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import CardHeading from '@/components/admin/CardHeading.vue'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useAdminAction } from '@/composables/use-admin-action'

const props = defineProps<{
  boardId: string
  enabled: boolean
  subscriberCount: number
  // The Kita is paused on the hosted instance: nothing here can be changed
  paused?: boolean
}>()

const { pending, run } = useAdminAction()
const statusId = useId()

// Follows the click right away; a failed save puts it back
const checked = ref(props.enabled)
const confirmOpen = ref(false)

// "auf 1 Gerät", "auf 3 Geräten"
const onDevices = computed(() =>
  props.subscriberCount === 1
    ? 'auf 1 Gerät'
    : `auf ${props.subscriberCount.toLocaleString('de-DE')} Geräten`,
)

const status = computed(() => {
  if (!props.enabled)
    return 'Auf dem Brett lassen sie sich derzeit nicht aktivieren.'
  if (props.subscriberCount === 0) return 'Bisher hat sie niemand aktiviert.'
  return `Derzeit ${onDevices.value} aktiviert.`
})

async function save(enabled: boolean) {
  checked.value = enabled
  const ok = await run(
    () => actions.boards.setPushEnabled({ id: props.boardId, enabled }),
    {
      leave: {
        reload: true,
        toast: enabled
          ? 'Benachrichtigungen sind erlaubt.'
          : 'Benachrichtigungen sind ausgeschaltet.',
      },
    },
  )
  if (!ok) checked.value = props.enabled
}

function toggle(enabled: boolean) {
  // Switching off deletes the subscriptions, so ask first when there are any
  if (!enabled && props.subscriberCount > 0) confirmOpen.value = true
  else void save(enabled)
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading>Benachrichtigungen</CardHeading>
      <CardDescription>
        Eltern können auf der Kita-Seite oder auf dem Brett die Glocke antippen
        und erfahren dann auf dem Handy, sobald hier ein neuer Zettel hängt.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Field orientation="horizontal">
        <Switch
          id="board-push-enabled"
          :model-value="checked"
          :disabled="pending || paused"
          :aria-describedby="statusId"
          @update:model-value="toggle"
        />
        <FieldContent>
          <FieldLabel for="board-push-enabled">
            Benachrichtigungen erlauben
          </FieldLabel>
          <FieldDescription :id="statusId">{{ status }}</FieldDescription>
        </FieldContent>
      </Field>
      <ConfirmDialog
        v-model:open="confirmOpen"
        title="Benachrichtigungen ausschalten?"
        :description="`Die Benachrichtigungen ${onDevices} werden gelöscht. Wer sie später wieder möchte, muss sie auf dem Brett neu aktivieren.`"
        confirm-label="Ausschalten"
        @confirm="save(false)"
      />
    </CardContent>
  </Card>
</template>
