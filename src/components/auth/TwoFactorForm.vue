<script setup lang="ts">
import { ref, useId } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import TotpCodeInput from '@/components/auth/TotpCodeInput.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import { fieldAria } from '@/lib/field-aria'

const props = defineProps<{ redirectTo: string }>()

const useBackupCode = ref(false)
const code = ref('')
const trustDevice = ref(false)
const { error, pending, run } = useFormSubmit()
const errorId = useId()
const hintId = useId()

async function submit() {
  // Backup codes get copied from a file or a note, spaces and all
  const payload = { code: code.value.trim(), trustDevice: trustDevice.value }
  // The input completes on the sixth digit, also while a request is running;
  // run drops that second call without an error, so the code stays
  const ok = await run(
    () =>
      useBackupCode.value
        ? authClient.twoFactor.verifyBackupCode(payload)
        : authClient.twoFactor.verifyTotp(payload),
    { leave: { href: props.redirectTo } },
  )
  if (!ok && error.value) code.value = ''
}

function toggleMethod() {
  useBackupCode.value = !useBackupCode.value
  code.value = ''
  error.value = null
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Bestätigung in zwei Schritten</CardHeading>
      <CardDescription>
        {{
          useBackupCode
            ? 'Geben Sie einen Ihrer Backup-Codes ein.'
            : 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <!-- Whatever goes wrong here is about the code just entered -->
          <FormError :id="errorId" :message="error" />
          <Field v-if="useBackupCode">
            <FieldLabel for="backup-code">Backup-Code</FieldLabel>
            <Input
              id="backup-code"
              v-model="code"
              autocomplete="one-time-code"
              required
              v-bind="fieldAria({ error: !!error && errorId })"
            />
          </Field>
          <Field v-else class="items-center">
            <FieldLabel for="totp-code" class="sr-only">Code</FieldLabel>
            <TotpCodeInput
              id="totp-code"
              v-model="code"
              v-bind="
                fieldAria({
                  error: !!error && errorId,
                  hint: hintId,
                })
              "
              @complete="submit"
            />
            <FieldDescription :id="hintId" class="text-center">
              Sechsstelliger Code aus Ihrer Authenticator-App. Mit der sechsten
              Ziffer wird er automatisch bestätigt.
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="trust-device" v-model="trustDevice" />
            <FieldLabel for="trust-device" class="font-normal">
              Diesem Gerät 30 Tage vertrauen
            </FieldLabel>
          </Field>
          <Button type="submit" :disabled="pending">Bestätigen</Button>
          <Button type="button" variant="link" @click="toggleMethod">
            {{
              useBackupCode
                ? 'Authenticator-App verwenden'
                : 'Backup-Code verwenden'
            }}
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
