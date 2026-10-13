<script setup lang="ts">
import { useId } from 'vue'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { REFERENCE_LABEL } from '@/lib/hosted/billing'
import {
  BILLING_ADDRESS_MAX,
  BILLING_NAME_MAX,
  BILLING_REFERENCE_MAX,
  EMAIL_MAX_LENGTH,
} from '@/lib/limits'
import { rejectBlank } from '@/lib/reject-blank'

// Where an invoice of the hosted instance goes, and what it has to carry for
// the Kita's administration. The server checks all four again
// (src/actions/subscription.ts).
const name = defineModel<string>('name', { required: true })
const address = defineModel<string>('address', { required: true })
const email = defineModel<string>('email', { required: true })
const reference = defineModel<string>('reference', { required: true })
const nameHintId = useId()
const emailHintId = useId()
const referenceHintId = useId()
</script>

<template>
  <Field>
    <FieldLabel for="billing-name">Rechnungsempfänger</FieldLabel>
    <Input
      id="billing-name"
      v-model="name"
      autocomplete="organization"
      :maxlength="BILLING_NAME_MAX"
      required
      :aria-describedby="nameHintId"
      @input="rejectBlank($event, 'Bitte geben Sie den Rechnungsempfänger an.')"
    />
    <FieldDescription :id="nameHintId">
      Name der Kita oder des Trägers, auf den die Rechnung lautet.
    </FieldDescription>
  </Field>
  <Field>
    <FieldLabel for="billing-address">Rechnungsanschrift</FieldLabel>
    <Textarea
      id="billing-address"
      v-model="address"
      autocomplete="street-address"
      :maxlength="BILLING_ADDRESS_MAX"
      rows="4"
      required
      @input="rejectBlank($event, 'Bitte geben Sie die Rechnungsanschrift an.')"
    />
  </Field>
  <Field>
    <FieldLabel for="billing-email">Rechnungs-E-Mail</FieldLabel>
    <Input
      id="billing-email"
      v-model="email"
      type="email"
      autocomplete="email"
      :maxlength="EMAIL_MAX_LENGTH"
      required
      :aria-describedby="emailHintId"
    />
    <FieldDescription :id="emailHintId">
      Dorthin gehen die Rechnung und die Bestätigung dieser Anfrage.
    </FieldDescription>
  </Field>
  <Field>
    <FieldLabel for="billing-reference">
      {{ REFERENCE_LABEL }} (optional)
    </FieldLabel>
    <Input
      id="billing-reference"
      v-model="reference"
      autocomplete="off"
      :maxlength="BILLING_REFERENCE_MAX"
      :aria-describedby="referenceHintId"
    />
    <FieldDescription :id="referenceHintId">
      Falls Ihre Verwaltung oder Ihr Träger eine Leitweg-ID oder eine
      Bestellnummer auf der Rechnung braucht.
    </FieldDescription>
  </Field>
</template>
