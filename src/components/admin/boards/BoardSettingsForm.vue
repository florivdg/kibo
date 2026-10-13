<script setup lang="ts">
import { actions } from 'astro:actions'
import { ref } from 'vue'

import BoardDetailsFields from '@/components/admin/boards/BoardDetailsFields.vue'
import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useFormSubmit } from '@/composables/use-form-submit'

const props = defineProps<{
  boardId: string
  name: string
  description: string
  typeLabel: string
  // The Kita is paused on the hosted instance: nothing here can be changed
  paused?: boolean
}>()

const name = ref(props.name)
const description = ref(props.description)
const { error, pending, run } = useFormSubmit()

async function submit() {
  // Page title and breadcrumbs show the name too
  await run(
    () =>
      actions.boards.update({
        id: props.boardId,
        name: name.value,
        description: description.value,
      }),
    { leave: { reload: true, toast: 'Die Einstellungen wurden gespeichert.' } },
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading>Einstellungen</CardHeading>
      <CardDescription>Art: {{ typeLabel }}</CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <BoardDetailsFields
            v-model:name="name"
            v-model:description="description"
          />
          <Button
            type="submit"
            class="self-start"
            :disabled="pending || paused"
          >
            Speichern
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
