<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import OrganizationNameField from '@/components/auth/OrganizationNameField.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'

const props = defineProps<{ organizationId: string; name: string }>()

const name = ref(props.name)
const { error, pending, run } = useFormSubmit()

async function submit() {
  const trimmed = name.value.trim()
  if (trimmed === props.name) {
    error.value = 'Die Kita heißt bereits so.'
    return
  }
  // The slug stays: it is internal and nobody gets to see it
  // The Kita switcher shows the name too
  await run(
    () =>
      authClient.organization.update({
        organizationId: props.organizationId,
        data: { name: trimmed },
      }),
    { leave: { reload: true, toast: `Die Kita heißt jetzt „${trimmed}“.` } },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Name</CardHeading>
      <CardDescription>
        Steht auf allen Brettern der Kita, für Eltern gut sichtbar.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <OrganizationNameField v-model="name" />
          <Button type="submit" class="self-start" :disabled="pending">
            Speichern
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
