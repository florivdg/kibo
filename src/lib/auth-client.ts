import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'

// Same origin as the app, so no baseURL is needed
export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    twoFactorClient({
      // Keep the login page's ?redirectTo= for after verification
      onTwoFactorRedirect() {
        window.location.href = `/admin/two-factor${window.location.search}`
      },
    }),
    // No passkeyClient(): it would pull @simplewebauthn/browser into every
    // page that uses this client. Signing in and adding one go through
    // src/lib/passkeys/sign-in-client.ts and register-client.ts, which run
    // the ceremonies themselves; removing is a plain $fetch
    // (PasskeySettings.vue).
  ],
})
