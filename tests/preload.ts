import { plugin } from 'bun'

import { ActionError, defineAction } from './helpers/astro-actions'
import { RFC8291_SERVER_KEYS } from './helpers/rfc8291-keys'

// Server modules read their configuration from `astro:env/server`, which only
// Astro's build provides. Tests talk to the local PostgreSQL from
// `bun run db:up`, so the stub passes that connection string through.
plugin({
  name: 'astro-env-server',
  setup(build) {
    build.module('astro:env/server', () => ({
      loader: 'object',
      exports: {
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://kibo:kibo_dev_password@localhost:5432/kibo',
        BETTER_AUTH_URL: 'http://localhost:4321',
        BETTER_AUTH_SECRET: 'test-secret-not-used-for-anything-real',
        TRUSTED_PROXIES: '',
        SIGNUP_MODE: 'open',
        SIGNUP_EMAIL_DOMAINS: '',
        HOSTED: '',
        DOCS_URL: '',
        HOSTED_PRICE_EUR: '',
        HOSTED_INCLUDED_KITAS: '',
        HOSTED_EXTRA_KITA_EUR: '',
        HOSTED_TRIAL_DAYS: '',
        HOSTED_PRICE_NOTE: '',
        SOURCE_URL: '',
        // Off, as on every instance that doesn't set them; the tests of the
        // page-view counting switch it on in place (analytics in
        // src/lib/instance.ts)
        PLAUSIBLE_DOMAIN: '',
        PLAUSIBLE_URL: '',
        // Empty like on a self-hosted instance that hasn't set them; the
        // mail tests fill in operatorDetails (src/lib/instance.ts) in place
        OPERATOR_NAME: '',
        OPERATOR_ADDRESS: '',
        OPERATOR_EMAIL: '',
        OPERATOR_LEGAL_INFO: '',
        // Only read once a test switches the hosted instance on
        HOSTED_TERMS_VERSION: '2026-10',
        HOSTED_OPERATOR_EMAIL: 'betrieb@kibo.example',
        AGB_URL: '',
        AVV_URL: '',
        IMPRESSUM_URL: undefined,
        DATENSCHUTZ_URL: undefined,
        LEGAL_DIR: './legal',
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: 'Kibo <kibo@localhost>',
        SMTP_SECURE: undefined,
        SMTP_ALLOW_INSECURE: false,
        // Push is switched on for the tests
        VAPID_PUBLIC_KEY: RFC8291_SERVER_KEYS.publicKey,
        VAPID_PRIVATE_KEY: JSON.stringify(RFC8291_SERVER_KEYS.privateJwk),
        VAPID_SUBJECT: 'mailto:kibo@localhost',
      },
    }))
  },
})

// `astro:actions` is a virtual module of Astro's build as well. The stand-in
// runs an action the way Astro does on the server — the input through its
// schema, then the handler — so the tests call the real actions in
// src/actions/ (see tests/helpers/astro-actions.ts).
plugin({
  name: 'astro-actions',
  setup(build) {
    build.module('astro:actions', () => ({
      loader: 'object',
      exports: { ActionError, defineAction },
    }))
  },
})
