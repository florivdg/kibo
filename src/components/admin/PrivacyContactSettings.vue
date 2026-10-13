<script setup lang="ts">
import { actions } from 'astro:actions'
import { ref, useId } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useFormSubmit, type SubmitError } from '@/composables/use-form-submit'
import { authErrorMessage } from '@/lib/auth-errors'
import {
  normalizePrivacyContact,
  PRIVACY_CONTACT_INVALID,
} from '@/lib/board/privacy-contact'
import { PRIVACY_CONTACT_MAX } from '@/lib/limits'

// The hosted instance only (src/pages/admin/kita.astro): whom parents ask
// about data protection, shown with the Kita's name at the foot of every page
// of its link. The owner sets it (src/actions/kita.ts), everyone else of the
// Kita sees it.
const props = defineProps<{
  privacyContact: string | null
  canEdit: boolean
}>()

// A refusal of the action comes as a ready sentence
function contactErrorMessage(failure: SubmitError) {
  return (
    (failure.code === 'BAD_REQUEST' && failure.message) ||
    authErrorMessage(failure)
  )
}

const value = ref(props.privacyContact ?? '')
const hintId = useId()
const { error, pending, refuse, run } = useFormSubmit(contactErrorMessage)

async function submit() {
  const privacyContact = normalizePrivacyContact(value.value)
  if (privacyContact === undefined) {
    refuse('PRIVACY_CONTACT_INVALID', PRIVACY_CONTACT_INVALID)
    return
  }
  await run(
    () => actions.kita.setPrivacyContact({ privacyContact: value.value }),
    {
      leave: {
        reload: true,
        toast: privacyContact
          ? 'Der Datenschutz-Kontakt wurde gespeichert.'
          : 'Der Datenschutz-Kontakt wurde entfernt.',
      },
    },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Datenschutz-Kontakt</CardHeading>
      <CardDescription>
        Für die Bretter ist Ihre Kita verantwortlich, das steht unten auf jeder
        Seite des Kita-Links. Dazu kann eine E-Mail-Adresse oder ein Link
        stehen, an die sich Eltern mit Fragen zum Datenschutz wenden.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form v-if="canEdit" @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <Field>
            <FieldLabel for="privacy-contact"
              >E-Mail-Adresse oder Link</FieldLabel
            >
            <Input
              id="privacy-contact"
              v-model="value"
              autocomplete="off"
              spellcheck="false"
              placeholder="datenschutz@traeger.de"
              :maxlength="PRIVACY_CONTACT_MAX"
              :aria-describedby="hintId"
            />
            <FieldDescription :id="hintId">
              Eine Adresse oder eine Seite mit https://, zum Beispiel die
              Datenschutzhinweise Ihres Trägers. Leer lassen, um nichts
              anzuzeigen.
            </FieldDescription>
          </Field>
          <Button type="submit" class="self-start" :disabled="pending">
            Speichern
          </Button>
        </FieldGroup>
      </form>
      <p v-else class="text-sm wrap-anywhere text-muted-foreground">
        <template v-if="privacyContact">
          Angegeben: {{ privacyContact }}.
        </template>
        <template v-else>Keiner angegeben.</template>
        Ändern kann das nur die Inhaberin oder der Inhaber.
      </p>
    </CardContent>
  </Card>
</template>
