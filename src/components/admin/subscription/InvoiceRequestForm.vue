<script setup lang="ts">
import { actions, isInputError } from 'astro:actions'
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import BillingFields from '@/components/admin/subscription/BillingFields.vue'
import FormError from '@/components/auth/FormError.vue'
import TermsField from '@/components/auth/TermsField.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useFormSubmit, type SubmitError } from '@/composables/use-form-submit'
import { authErrorMessage } from '@/lib/auth-errors'
import { TERMS_NOT_ACCEPTED } from '@/lib/hosted/messages'

// Only the owner of the subscription gets this form. The fields start with
// where the last invoice went. `requested`: a request is open, and sending
// the form again corrects it. `terms`: the account has not agreed to the
// current terms yet and does so with the request — the links to them.
const props = defineProps<{
  billingName: string
  billingAddress: string
  billingEmail: string
  billingReference: string
  requested: boolean
  // "1. Januar 2027 bis 31. Dezember 2027"
  period: string
  terms?: { agbHref: string; avvHref: string; version: string }
}>()

// What the action turns away it words itself (src/actions/subscription.ts):
// a refusal with its reason, a budget that is used up with the wait. What the
// schema says about a field comes under the first of the two codes as well,
// and is not for the form to repeat.
const WORDED = ['BAD_REQUEST', 'TOO_MANY_REQUESTS']

function invoiceErrorMessage(failure: SubmitError) {
  const worded = WORDED.includes(String(failure.code)) && !isInputError(failure)
  return (worded && failure.message) || authErrorMessage(failure)
}

const name = ref(props.billingName)
const address = ref(props.billingAddress)
const email = ref(props.billingEmail)
const reference = ref(props.billingReference)
const acceptTerms = ref(false)
const { error, pending, run } = useFormSubmit(invoiceErrorMessage)

async function submit() {
  if (props.terms && !acceptTerms.value) {
    error.value = TERMS_NOT_ACCEPTED
    return
  }
  await run(
    () =>
      actions.subscription.requestInvoice({
        billingName: name.value,
        billingAddress: address.value,
        billingEmail: email.value,
        billingReference: reference.value,
        acceptTerms: acceptTerms.value,
        termsVersion: props.terms?.version,
      }),
    {
      leave: {
        reload: true,
        toast: 'Rechnung angefordert. Die Bestätigung kommt per E-Mail.',
      },
    },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Rechnung anfordern</CardHeading>
      <CardDescription>
        Die Rechnung gilt für ein Jahr, vom {{ period }}, und geht per E-Mail an
        die Adresse unten. Beenden Sie den Vertrag vor Ablauf dieses Jahres,
        wird der bezahlte Betrag nicht anteilig erstattet.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <BillingFields
            v-model:name="name"
            v-model:address="address"
            v-model:email="email"
            v-model:reference="reference"
          />
          <TermsField v-if="terms" v-model="acceptTerms" v-bind="terms" />
          <Button type="submit" class="self-start" :disabled="pending">
            {{ requested ? 'Rechnung erneut anfordern' : 'Rechnung anfordern' }}
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
