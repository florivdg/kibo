<script setup lang="ts">
import { ref, watch } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'

// The Kitas the account owns. They are deleted with it, whoever else manages
// them; `otherMembers` is how many admins that takes the Kita away from.
const props = defineProps<{
  ownedOrganizations: { id: string; name: string; otherMembers: number }[]
}>()

function otherMembersLabel(count: number) {
  return count === 1 ? '(+1 weiterer Admin)' : `(+${count} weitere Admins)`
}

const open = ref(false)
const password = ref('')
const { error, pending, run } = useFormSubmit()

// A cancelled attempt leaves nothing behind for the next one
watch(open, (isOpen) => {
  if (isOpen) return
  password.value = ''
  error.value = null
})

async function submit() {
  await run(() => authClient.deleteUser({ password: password.value }), {
    leave: { href: '/admin/login' },
  })
}
</script>

<template>
  <Card class="max-w-xl border-destructive/50">
    <CardHeader>
      <CardHeading class="text-destructive">Gefahrenzone</CardHeading>
      <CardDescription>
        Löschen Sie Ihr Konto, werden Ihre Anmeldedaten dauerhaft entfernt. Das
        lässt sich nicht rückgängig machen.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div v-if="props.ownedOrganizations.length" class="space-y-2 text-sm">
        <p>
          Diese Kitas gehören Ihnen. Sie werden mit allen Brettern, Zetteln und
          Mitgliedschaften gelöscht – auch wenn dort noch andere Personen
          mitverwalten:
        </p>
        <ul class="list-disc pl-5 font-medium">
          <li
            v-for="organization in props.ownedOrganizations"
            :key="organization.id"
          >
            {{ organization.name }}
            <span
              v-if="organization.otherMembers"
              class="font-normal text-muted-foreground"
            >
              {{ otherMembersLabel(organization.otherMembers) }}
            </span>
          </li>
        </ul>
      </div>
      <p class="text-sm text-muted-foreground">
        Kitas, in denen Sie nur mitverwalten, bleiben bestehen; nur Ihre
        Mitgliedschaft endet.
      </p>
      <AlertDialog v-model:open="open">
        <AlertDialogTrigger as-child>
          <Button variant="destructive">Konto löschen</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <form class="grid gap-4" @submit.prevent="submit">
            <AlertDialogHeader>
              <AlertDialogTitle>Konto endgültig löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                {{
                  props.ownedOrganizations.length
                    ? 'Ihr Konto und die oben genannten Kitas mit allen Brettern und Zetteln werden sofort gelöscht – auch für die Personen, die dort mitverwalten.'
                    : 'Ihr Konto wird sofort gelöscht.'
                }}
                Bestätigen Sie mit Ihrem Passwort.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldGroup>
              <FormError :message="error" />
              <Field>
                <FieldLabel for="delete-account-password">Passwort</FieldLabel>
                <Input
                  id="delete-account-password"
                  v-model="password"
                  type="password"
                  autocomplete="current-password"
                  required
                />
              </Field>
            </FieldGroup>
            <AlertDialogFooter>
              <AlertDialogCancel :disabled="pending"
                >Abbrechen</AlertDialogCancel
              >
              <Button type="submit" variant="destructive" :disabled="pending">
                Endgültig löschen
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent>
  </Card>
</template>
