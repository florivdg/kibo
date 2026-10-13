<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
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
import { useAdminAction } from '@/composables/use-admin-action'
import { useFormSubmit, type SubmitError } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import { PASSKEY_NAME_MAX, PASSKEYS_PER_ACCOUNT } from '@/lib/limits'
import { passkeysSupported } from '@/lib/passkeys/ceremony'
import type { PasskeyListItem } from '@/lib/passkeys/queries'
import { registerPasskey } from '@/lib/passkeys/register-client'

// The account's passkeys, read by the page (src/lib/passkeys/queries.ts)
const props = defineProps<{ passkeys: PasskeyListItem[] }>()

const name = ref('')
const password = ref('')
const { error, pending, run } = useFormSubmit()
const { pending: removing, run: runRemove } = useAdminAction()
const atLimit = computed(() => props.passkeys.length >= PASSKEYS_PER_ACCOUNT)

// Decided after mounting; the server can't know. Shown until then, since
// nearly every browser has passkeys.
const supported = ref(true)
onMounted(() => {
  supported.value = passkeysSupported()
})

// The browser asks for a fingerprint, face or PIN in between; a closed
// dialog ends without a word and without leaving the page
async function add() {
  await run(
    () => registerPasskey({ name: name.value, password: password.value }),
    {
      leave: (result) =>
        result.data
          ? { reload: true, toast: 'Passkey hinzugefügt.' }
          : undefined,
    },
  )
}

// Removing one takes no password: it narrows the ways into the account, and
// password and code stay as they are
function remove(passkey: PasskeyListItem) {
  return runRemove(
    async () => {
      const result = await authClient.$fetch<unknown, SubmitError>(
        '/passkey/delete-passkey',
        {
          method: 'POST',
          body: { id: passkey.id },
        },
      )
      // Already gone, removed in another tab perhaps: what was asked for is
      // done, so the page reloads like after any removal
      return result.error?.code === 'PASSKEY_NOT_FOUND'
        ? { error: null }
        : result
    },
    { leave: { reload: true, toast: 'Passkey entfernt.' } },
  )
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>Passkeys</CardHeading>
      <CardDescription>
        Mit einem Passkey melden Sie sich ohne Passwort und ohne Code an – mit
        Fingerabdruck, Gesicht oder der PIN Ihres Geräts.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <div v-if="props.passkeys.length" class="space-y-2">
        <h3 id="passkeys-heading" class="text-sm font-medium">
          Ihre Passkeys ({{ props.passkeys.length }} von
          {{ PASSKEYS_PER_ACCOUNT }})
        </h3>
        <ul
          aria-labelledby="passkeys-heading"
          class="divide-y rounded-md border text-sm"
        >
          <li
            v-for="passkey in props.passkeys"
            :key="passkey.id"
            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{{ passkey.label }}</p>
              <p v-if="passkey.added" class="text-muted-foreground">
                Hinzugefügt am {{ passkey.added }}
              </p>
            </div>
            <ConfirmDialog
              title="Passkey entfernen?"
              :description="`Mit „${passkey.label}“ können Sie sich danach nicht mehr anmelden. Ihr Passwort und die Bestätigung in zwei Schritten bleiben, wie sie sind.`"
              confirm-label="Entfernen"
              :pending="removing"
              @confirm="remove(passkey)"
            >
              <Button
                variant="outline"
                size="sm"
                class="aria-disabled:opacity-50"
                :aria-disabled="removing"
                :aria-label="`Entfernen: Passkey ${passkey.label}`"
              >
                Entfernen
              </Button>
            </ConfirmDialog>
          </li>
        </ul>
      </div>
      <p v-if="!supported" class="text-sm text-muted-foreground">
        Dieser Browser unterstützt keine Passkeys. Öffnen Sie diese Seite in
        einem aktuellen Browser, um einen hinzuzufügen.
      </p>
      <p v-else-if="atLimit" class="text-sm text-muted-foreground">
        Ein Konto kann höchstens {{ PASSKEYS_PER_ACCOUNT }} Passkeys haben.
        Entfernen Sie einen, um einen neuen hinzuzufügen.
      </p>
      <form v-else @submit.prevent="add">
        <FieldGroup>
          <FormError :message="error" />
          <Field>
            <FieldLabel for="passkey-name">Bezeichnung (optional)</FieldLabel>
            <Input
              id="passkey-name"
              v-model="name"
              :maxlength="PASSKEY_NAME_MAX"
              autocomplete="off"
              placeholder="z. B. Laptop im Büro"
            />
          </Field>
          <Field>
            <FieldLabel for="passkey-password">Passwort bestätigen</FieldLabel>
            <Input
              id="passkey-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </Field>
          <Button type="submit" class="self-start" :disabled="pending">
            Passkey hinzufügen
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
