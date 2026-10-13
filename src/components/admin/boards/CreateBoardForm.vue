<script setup lang="ts">
import { actions } from 'astro:actions'
import { ref, useId, watch } from 'vue'

import BoardDetailsFields from '@/components/admin/boards/BoardDetailsFields.vue'
import FormError from '@/components/auth/FormError.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useFormSubmit } from '@/composables/use-form-submit'
import {
  BOARD_TYPE_IDS,
  BOARD_TYPES,
  type BoardType,
} from '@/lib/board/board-types'

const type = ref<BoardType>('fundkiste')
const name = ref(BOARD_TYPES.fundkiste.label)
const description = ref('')
const { error, pending, run } = useFormSubmit()
const typeHintId = useId()

// Suggest the type's name until the admin picks their own
watch(type, (next, previous) => {
  if (name.value === BOARD_TYPES[previous].label) {
    name.value = BOARD_TYPES[next].label
  }
})

async function submit() {
  await run(
    () =>
      actions.boards.create({
        type: type.value,
        name: name.value,
        description: description.value,
      }),
    {
      leave: ({ data }) => data && { href: `/admin/boards/${data.id}` },
    },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <FieldSet>
            <FieldLegend>Art des Bretts</FieldLegend>
            <FieldDescription :id="typeHintId">
              Die Art legt fest, welche Kategorien Eltern beim Anpinnen wählen
              können. Sie lässt sich später nicht ändern.
            </FieldDescription>
            <RadioGroup v-model="type" :aria-describedby="typeHintId">
              <FieldLabel
                v-for="id in BOARD_TYPE_IDS"
                :key="id"
                :for="`board-type-${id}`"
              >
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{{ BOARD_TYPES[id].label }}</FieldTitle>
                    <FieldDescription>
                      {{ BOARD_TYPES[id].summary }} Kategorien:
                      {{
                        BOARD_TYPES[id].categories
                          .map((category) => category.label)
                          .join(', ')
                      }}
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem :id="`board-type-${id}`" :value="id" />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldSet>
          <BoardDetailsFields
            v-model:name="name"
            v-model:description="description"
          />
          <Button type="submit" class="self-start" :disabled="pending">
            Brett anlegen
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
