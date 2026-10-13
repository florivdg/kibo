<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import TwoFactorEnrollment from '@/components/admin/TwoFactorEnrollment.vue'
import ConfirmDialog from '@/components/admin/boards/ConfirmDialog.vue'
import FormError from '@/components/auth/FormError.vue'
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

const props = defineProps<{ enabled: boolean }>()

const password = ref('')
const confirmingDisable = ref(false)
const enrollment = ref<{ totpUri: string; backupCodes: string[] } | null>(null)
const { error, pending, run } = useFormSubmit()

// Enabling returns the TOTP secret; 2FA only turns on once a code is confirmed
async function enable() {
  await run(async () => {
    const result = await authClient.twoFactor.enable({
      password: password.value,
    })
    if (result.data && 'totpURI' in result.data) {
      enrollment.value = {
        totpUri: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      }
    }
    return result
  })
}

async function disable() {
  await run(() => authClient.twoFactor.disable({ password: password.value }), {
    leave: { reload: true },
  })
}

// Turning protection off asks first, like the other destructive actions
function submit() {
  if (props.enabled) confirmingDisable.value = true
  else void enable()
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Bestätigung in zwei Schritten</CardHeading>
      <CardDescription>
        {{
          props.enabled
            ? 'Aktiv. Bei der Anmeldung wird ein Code aus Ihrer Authenticator-App abgefragt.'
            : 'Schützen Sie Ihr Konto zusätzlich mit einer Authenticator-App.'
        }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <TwoFactorEnrollment v-if="enrollment" v-bind="enrollment" />
      <form v-else @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <Field>
            <FieldLabel for="current-password">Passwort bestätigen</FieldLabel>
            <Input
              id="current-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </Field>
          <Button
            type="submit"
            class="self-start"
            :variant="props.enabled ? 'destructive' : 'default'"
            :disabled="pending"
          >
            {{ props.enabled ? 'Deaktivieren' : 'Einrichten' }}
          </Button>
        </FieldGroup>
      </form>
      <ConfirmDialog
        v-model:open="confirmingDisable"
        title="Bestätigung in zwei Schritten deaktivieren?"
        description="Bei der Anmeldung genügt danach wieder Ihr Passwort. Ihre bisherigen Backup-Codes werden ungültig."
        confirm-label="Deaktivieren"
        @confirm="disable"
      />
    </CardContent>
  </Card>
</template>
