<script setup lang="ts">
import { ref } from 'vue'

import CardHeading from '@/components/admin/CardHeading.vue'
import FormError from '@/components/auth/FormError.vue'
import OrganizationNameField from '@/components/auth/OrganizationNameField.vue'
import SignOutLink from '@/components/auth/SignOutLink.vue'
import TermsField from '@/components/auth/TermsField.vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { organizationSlug } from '@/lib/organization-slug'

// `canCancel`: the admin already has a Kita to go back to. `terms`: on the
// hosted instance the account agrees to the terms and the data processing
// agreement before its first Kita — the links to the two, or nothing when
// there is nothing to agree to.
const props = defineProps<{
  canCancel: boolean
  terms?: { agbHref: string; avvHref: string; version: string }
}>()

const name = ref('')
const acceptTerms = ref(false)
const { error, pending, run } = useFormSubmit()

async function submit() {
  if (props.terms && !acceptTerms.value) {
    error.value = authErrorMessage({ code: 'TERMS_NOT_ACCEPTED' })
    return
  }
  const trimmed = name.value.trim()
  // The server reads `acceptTerms` and the version the links showed itself
  // (checkKitaCreation in src/lib/auth.ts); Better Auth's client knows no
  // such fields
  const organization = {
    name: trimmed,
    slug: organizationSlug(trimmed),
    ...(props.terms
      ? { acceptTerms: true, termsVersion: props.terms.version }
      : {}),
  }
  // Creating an organization also makes it the active one
  await run(() => authClient.organization.create(organization), {
    leave: { href: '/admin' },
  })
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardHeading :level="1">Kita anlegen</CardHeading>
      <CardDescription>
        Legen Sie die Kita an, die Sie mit Kibo verwalten.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form @submit.prevent="submit">
        <FieldGroup>
          <FormError :message="error" />
          <OrganizationNameField v-model="name" />
          <TermsField v-if="terms" v-model="acceptTerms" v-bind="terms" />
          <Button type="submit" :disabled="pending">Kita anlegen</Button>
          <Button v-if="canCancel" variant="outline" as="a" href="/admin">
            Abbrechen
          </Button>
          <!-- Signing out is the way out for someone who signed up with the
               wrong account -->
          <p
            class="flex flex-wrap justify-center gap-x-4 text-center text-sm text-muted-foreground"
          >
            <a href="/admin/account" class="underline underline-offset-4">
              Konto
            </a>
            <SignOutLink />
          </p>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>
</template>
