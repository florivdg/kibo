<script setup lang="ts">
import { computed, ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import EmailPasswordFields from '@/components/auth/EmailPasswordFields.vue'
import FormError from '@/components/auth/FormError.vue'
import FormNotice from '@/components/auth/FormNotice.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup, FieldSeparator } from '@/components/ui/field'
import { useFormSubmit } from '@/composables/use-form-submit'
import { usePasskeySignIn } from '@/composables/use-passkey-sign-in'
import { authClient } from '@/lib/auth-client'
import { VERIFY_EMAIL_PATH } from '@/lib/auth-paths'

// `passwordReset`: the reset page sent the admin here with a new password.
// `signupOpen`: whether this instance takes sign-ups (SIGNUP_MODE); the page
// reads it on the server.
const props = defineProps<{
  redirectTo: string
  passwordReset?: boolean
  signupOpen: boolean
}>()

const email = ref('')
const password = ref('')
const form = useFormSubmit()
const { error, errorCode, pending, run } = form
// Passkey attempts, from the field's suggestions and the button, go through
// the same form: one message, the one of the way last tried
const { supported: passkeySupported, signInWithButton } = usePasskeySignIn(
  props.redirectTo,
  form,
)

// Unconfirmed admins can't sign in, so offer them a fresh link with their
// address already filled in
const verifyEmailUrl = computed(() =>
  errorCode.value === 'EMAIL_NOT_VERIFIED'
    ? `${VERIFY_EMAIL_PATH}?email=${encodeURIComponent(email.value)}`
    : null,
)

async function submit() {
  let needsTwoFactor = false
  await run(
    async () => {
      const result = await authClient.signIn.email({
        email: email.value,
        password: password.value,
      })
      needsTwoFactor = !!result.data && 'twoFactorRedirect' in result.data
      return result
    },
    {
      // With 2FA enabled the client plugin redirects to the verification page
      leave: () =>
        needsTwoFactor ? { redirected: true } : { href: props.redirectTo },
    },
  )
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Anmelden</CardHeading>
      <CardDescription>Melden Sie sich bei Kibo an.</CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <FormNotice
            :message="
              passwordReset && !error
                ? 'Ihr Passwort wurde geändert. Bitte melden Sie sich mit dem neuen Passwort an.'
                : null
            "
          />
          <p
            v-if="verifyEmailUrl"
            class="text-center text-sm text-muted-foreground"
          >
            <a :href="verifyEmailUrl" class="underline underline-offset-4">
              Bestätigungslink erneut anfordern
            </a>
          </p>
          <EmailPasswordFields
            v-model:email="email"
            v-model:password="password"
          />
          <Button type="submit" :disabled="pending">Anmelden</Button>
          <template v-if="passkeySupported">
            <FieldSeparator
              class="*:data-[slot=field-separator-content]:bg-card"
            >
              oder
            </FieldSeparator>
            <Button
              type="button"
              variant="outline"
              :disabled="pending"
              @click="signInWithButton"
            >
              Mit Passkey anmelden
            </Button>
          </template>
          <p class="text-center text-sm text-muted-foreground">
            <a
              href="/admin/forgot-password"
              class="underline underline-offset-4"
            >
              Passwort vergessen?
            </a>
          </p>
          <p
            v-if="signupOpen"
            class="text-center text-sm text-muted-foreground"
          >
            Noch kein Konto?
            <a href="/admin/signup" class="underline underline-offset-4">
              Registrieren
            </a>
          </p>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
