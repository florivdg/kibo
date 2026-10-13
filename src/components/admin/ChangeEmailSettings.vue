<script setup lang="ts">
import { onMounted, ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import FormNotice from '@/components/auth/FormNotice.vue'
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
import { authErrorMessage } from '@/lib/auth-errors'
import { EMAIL_CHANGE_CALLBACK, EMAIL_CHANGE_MARKER } from '@/lib/auth-paths'

// `linkError` / `linkStep`: what the account page read from the URL. The two
// links of an address change land on different URLs: the first once the
// current address agreed, the second once the change is complete.
const props = defineProps<{
  currentEmail: string
  linkError: string | null
  linkStep: 'approved' | 'done' | null
}>()

const LINK_NOTICES = {
  approved:
    'Zustimmung erhalten. Wir haben jetzt einen zweiten Link an die neue Adresse geschickt. Öffnen Sie ihn in diesem Browser, dann ist die Änderung abgeschlossen.',
  done: `Die Änderung ist abgeschlossen. Ihre E-Mail-Adresse ist jetzt ${props.currentEmail}.`,
}

const newEmail = ref('')
const { error, pending, run } = useFormSubmit()
if (props.linkError) error.value = authErrorMessage({ code: props.linkError })
const notice = ref<string | null>(
  props.linkStep && !props.linkError ? LINK_NOTICES[props.linkStep] : null,
)

// Shown once: a reload would otherwise repeat a notice that is no longer news
onMounted(() => {
  const url = new URL(window.location.href)
  url.searchParams.delete(EMAIL_CHANGE_MARKER)
  url.searchParams.delete('error')
  window.history.replaceState(null, '', url)
})

async function submit() {
  notice.value = null
  const requested = newEmail.value.trim()
  if (requested.toLowerCase() === props.currentEmail.toLowerCase()) {
    error.value = 'Das ist bereits Ihre E-Mail-Adresse.'
    return
  }
  const ok = await run(() =>
    authClient.changeEmail({
      newEmail: requested,
      callbackURL: EMAIL_CHANGE_CALLBACK,
    }),
  )
  if (!ok) return
  newEmail.value = ''
  // Better Auth answers the same when the address is taken, but sends nothing
  notice.value = `Wir haben eine E-Mail an ${props.currentEmail} geschickt. Stimmen Sie der Änderung dort zu; danach erhalten Sie einen Link an ${requested}. Erst wenn Sie diesen öffnen, gilt die neue Adresse. Kommt keine E-Mail an, ist die neue Adresse womöglich schon vergeben.`
}
</script>

<template>
  <Card class="max-w-xl">
    <CardHeader>
      <CardHeading>E-Mail-Adresse ändern</CardHeading>
      <CardDescription>
        Aktuell:
        <span class="font-medium text-foreground">{{ props.currentEmail }}</span
        >. Die Änderung bestätigen Sie in zwei Schritten: zuerst über Ihre
        bisherige Adresse, dann über die neue.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <FormNotice :message="notice" />
          <Field>
            <FieldLabel for="new-email">Neue E-Mail-Adresse</FieldLabel>
            <Input
              id="new-email"
              v-model="newEmail"
              type="email"
              autocomplete="email"
              required
            />
          </Field>
          <Button type="submit" class="self-start" :disabled="pending">
            Bestätigungslink senden
          </Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
