<script setup lang="ts">
import { useFormSubmit } from '@/composables/use-form-submit'
import { authClient } from '@/lib/auth-client'

// Signing out from a page outside the admin shell, which has no menu for it.
// `href` is where the browser goes once the session is really gone — before
// that, the login page would bounce straight back to /admin. `class` replaces
// the look of a text link, for where this is the main action.
const props = withDefaults(defineProps<{ href?: string; class?: string }>(), {
  href: '/admin/login',
  class: 'underline underline-offset-4 disabled:opacity-50',
})

const { error, pending, run } = useFormSubmit()

async function signOut() {
  await run(() => authClient.signOut(), { leave: { href: props.href } })
}
</script>

<template>
  <button
    type="button"
    :class="props.class"
    :disabled="pending"
    @click="signOut"
  >
    <slot>Abmelden</slot>
  </button>
  <span
    v-if="error"
    role="alert"
    class="mt-2 block w-full text-sm text-destructive"
  >
    {{ error }}
  </span>
</template>
