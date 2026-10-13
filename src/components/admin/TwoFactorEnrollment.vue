<script setup lang="ts">
import { Copy, Download } from '@lucide/vue'
import { computed, ref, useId } from 'vue'

import QrCode from '@/components/admin/QrCode.vue'
import { copyWithToast } from '@/components/admin/toast'
import FormError from '@/components/auth/FormError.vue'
import TotpCodeInput from '@/components/auth/TotpCodeInput.vue'
import { Button } from '@/components/ui/button'
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
import { downloadText } from '@/lib/clipboard'
import { fieldAria } from '@/lib/field-aria'
import { qrCodeSvg } from '@/lib/qr-code'

const props = defineProps<{ totpUri: string; backupCodes: string[] }>()

const code = ref('')
// The codes are shown this once; 2FA only turns on after they are kept safe
const codesSaved = ref(false)
const { error, errorCode, pending, refuse, run } = useFormSubmit()
const errorId = useId()
const hintId = useId()

// The error is about the checkbox when it asks for it, else about the code
const codesNotSaved = computed(() => errorCode.value === 'CODES_NOT_SAVED')
const codesSavedAria = computed(() =>
  fieldAria({ error: codesNotSaved.value && errorId }),
)
const codeAria = computed(() =>
  fieldAria({
    error: !!error.value && !codesNotSaved.value && errorId,
    hint: hintId,
  }),
)

const qrCode = computed(() => qrCodeSvg(props.totpUri))
// What the QR code holds, to type in: the one way for an app on the very
// phone that shows this page
const secret = computed(
  () => new URL(props.totpUri).searchParams.get('secret') ?? '',
)
const codesText = computed(() => `${props.backupCodes.join('\n')}\n`)

function downloadCodes() {
  downloadText(
    `Kibo – Backup-Codes für die Anmeldung\n\n${codesText.value}`,
    'kibo-backup-codes.txt',
  )
}

async function confirm() {
  if (!codesSaved.value) {
    refuse(
      'CODES_NOT_SAVED',
      'Bitte bestätigen Sie, dass Sie die Backup-Codes gespeichert haben.',
    )
    return
  }
  // The input completes on the sixth digit, also while a request is running;
  // run drops that second call without an error, so the code stays
  const ok = await run(
    () => authClient.twoFactor.verifyTotp({ code: code.value }),
    { leave: { reload: true } },
  )
  if (!ok && error.value) code.value = ''
}
</script>

<template>
  <form @submit.prevent="confirm">
    <FieldGroup>
      <FormError :id="errorId" :message="error" />
      <Field>
        <h3 class="text-sm leading-snug font-medium">1. QR-Code scannen</h3>
        <!-- Field stretches direct children to full width; the inner box keeps the QR code square -->
        <div>
          <QrCode
            :svg="qrCode"
            class="size-48"
            role="img"
            aria-label="QR-Code zum Einrichten der Authenticator-App"
          />
        </div>
      </Field>
      <Field v-if="secret">
        <FieldLabel for="totp-secret">
          Oder diesen Schlüssel in der App eingeben
        </FieldLabel>
        <div class="flex flex-wrap gap-2">
          <Input
            id="totp-secret"
            :model-value="secret"
            readonly
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1 font-mono"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <Button
            type="button"
            variant="outline"
            @click="
              copyWithToast(secret, {
                done: 'Der Schlüssel wurde kopiert.',
                failed: 'Der Schlüssel konnte nicht kopiert werden.',
              })
            "
          >
            <Copy />
            Schlüssel kopieren
          </Button>
        </div>
      </Field>
      <Field>
        <h3 id="backup-codes-heading" class="text-sm leading-snug font-medium">
          2. Backup-Codes sicher aufbewahren
        </h3>
        <ul
          aria-labelledby="backup-codes-heading"
          class="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm"
        >
          <li v-for="backupCode in backupCodes" :key="backupCode">
            {{ backupCode }}
          </li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            @click="
              copyWithToast(codesText, {
                done: 'Die Backup-Codes wurden kopiert.',
                failed: 'Die Backup-Codes konnten nicht kopiert werden.',
              })
            "
          >
            <Copy />
            Kopieren
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            @click="downloadCodes"
          >
            <Download />
            Als .txt herunterladen
          </Button>
        </div>
        <FieldDescription>
          Jeder Code funktioniert einmal, falls Sie keinen Zugriff auf die App
          haben. Die Codes werden nur jetzt angezeigt.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id="backup-codes-saved"
          v-model="codesSaved"
          required
          v-bind="codesSavedAria"
        />
        <FieldLabel for="backup-codes-saved" class="font-normal">
          Ich habe die Backup-Codes sicher gespeichert.
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel for="totp-code">3. Code aus der App eingeben</FieldLabel>
        <TotpCodeInput
          id="totp-code"
          v-model="code"
          v-bind="codeAria"
          @complete="confirm"
        />
        <FieldDescription :id="hintId">
          Mit der sechsten Ziffer wird der Code automatisch bestätigt, sobald
          die Backup-Codes gesichert sind.
        </FieldDescription>
      </Field>
      <Button
        type="submit"
        class="self-start"
        :disabled="pending || !codesSaved"
      >
        Aktivieren
      </Button>
    </FieldGroup>
  </form>
</template>
