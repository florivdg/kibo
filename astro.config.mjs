// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config'

import { satteri } from '@astrojs/markdown-satteri'
import node from '@astrojs/node'
import vue from '@astrojs/vue'
import tailwindcss from '@tailwindcss/vite'

import { docLinks } from './src/lib/docs/doc-links.ts'
import { REQUEST_BODY_LIMIT } from './src/lib/limits.ts'

// https://astro.build/config
export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone',
    // The adapter's default is a gigabyte
    bodySizeLimit: REQUEST_BODY_LIMIT,
  }),

  // Trusting X-Forwarded-Host/-For is what makes clientAddress the visitor's
  // IP instead of the proxy's. The patterns are baked into the build, so one
  // image for every domain can only match on the protocol. That is no trust
  // check of the proxy — the deployment has to provide that part, see
  // docs/selbst-hosten/sicherheit.md. The spam budgets read the header
  // themselves (src/lib/spam/client-ip.ts) but rest on the same promise.
  security: {
    allowedDomains: [{ protocol: 'https' }],
    actionBodySizeLimit: REQUEST_BODY_LIMIT,
    // Sent as a header with every page. Astro adds the hashes of the inline
    // scripts and styles it renders itself (island hydration included), so
    // script-src needs nothing inline. Style attributes are allowed: Vue and
    // reka-ui render them for positioning. img-src takes data: for the QR
    // code download. The headers CSP doesn't cover are set in
    // src/lib/server/security-headers.ts.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
      ],
      styleDirective: {
        resources: [
          "'self'",
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
      },
    },
  },

  // The documentation under /docs is the one thing Astro renders from
  // Markdown (src/content.config.ts). Its code blocks stay plain: Shiki's
  // inline styles would need an exception in the CSP above. The plugin turns
  // the relative links between the files in docs/, written so that they work
  // on GitHub, into the addresses the pages have on the website.
  markdown: {
    syntaxHighlight: false,
    processor: satteri({ mdastPlugins: [docLinks()] }),
  },

  // The only images Astro handles are the screenshots in the documentation
  // and the photos of src/lib/images/responsive.ts, all optimised WebP files
  // already: they are served as they are, from /_astro/, without sharp. Astro
  // injects its /_image route all the same, and its own endpoint answers 500
  // with an error in the log when the service transforms nothing — so the
  // route gets one that answers 404.
  image: {
    service: { entrypoint: './src/lib/images/image-service.ts' },
    endpoint: {
      route: '/_image',
      entrypoint: './src/lib/images/image-endpoint.ts',
    },
  },

  integrations: [vue()],

  // Self-hosted at build time, so visitors' browsers never contact Google
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Playwrite DE Grund',
      cssVariable: '--font-playwrite',
      weights: [400],
      styles: ['normal'],
      // Google serves this handwriting font without a "latin" subset
      subsets: ['fallback'],
    },
    {
      provider: fontProviders.google(),
      name: 'Atkinson Hyperlegible Next',
      cssVariable: '--font-atkinson',
      weights: [400, 600, 700],
      styles: ['normal'],
    },
    // The admin panel's typeface
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
    },
  ],

  env: {
    schema: {
      DATABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      BETTER_AUTH_URL: envField.string({ context: 'server', access: 'secret' }),
      BETTER_AUTH_SECRET: envField.string({
        context: 'server',
        access: 'secret',
      }),
      // Reverse proxies in front of Kibo, as IPs or CIDRs, comma-separated.
      // Empty is right for a single proxy; see
      // docs/selbst-hosten/spam-schutz.md.
      TRUSTED_PROXIES: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Who may sign up: `open` (anyone) or `closed` (accounts come from
      // scripts/admin.ts), and optionally the mail domains an account may
      // have, comma-separated, `*.` in front for subdomains. Strings rather
      // than an enum, so the one rule is the parser in
      // scripts/instance-config.mjs (read in src/lib/instance.ts).
      SIGNUP_MODE: envField.string({
        context: 'server',
        access: 'secret',
        default: 'open',
      }),
      SIGNUP_EMAIL_DOMAINS: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // `true` on the hosted instance, which serves the documentation under
      // /docs and gives every account that owns Kitas a subscription
      // (src/lib/hosted/); everyone else links to DOCS_URL from the admin area
      // (empty: the docs folder on GitHub). Strings for the same reason as
      // SIGNUP_MODE.
      HOSTED: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      DOCS_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // What the hosted instance charges: euros a year, the Kitas that
      // includes, euros a year for each further Kita, and the days of the
      // trial. Empty means the default (HOSTED_PRICING_DEFAULTS). Strings,
      // because the one rule is again the parser in
      // scripts/instance-config.mjs — whole numbers only, where
      // envField.number would take 1e3 and 1.5.
      HOSTED_PRICE_EUR: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      HOSTED_INCLUDED_KITAS: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      HOSTED_EXTRA_KITA_EUR: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      HOSTED_TRIAL_DAYS: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Both required with HOSTED=true (scripts/instance-config.mjs): what
      // the terms an account agrees to are called, e.g. `2026-10`, and where
      // the invoice requests go
      HOSTED_TERMS_VERSION: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      HOSTED_OPERATOR_EMAIL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // One line the operator puts below the price of the hosted instance,
      // on the start page and on /admin/abo — what it says about VAT, for
      // one. Empty: nothing is said about it. No link, at most 200
      // characters (parsePriceNote in scripts/instance-config.mjs).
      HOSTED_PRICE_NOTE: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Where the footer's „Quelltext“ link leads. Empty is the repository;
      // whoever runs a changed version points it at that version's source
      // (AGPL § 13).
      SOURCE_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Page views of the hosted start page, counted by Plausible: the site's
      // domain as Plausible knows it (empty: nothing is counted) and the
      // instance it runs on (empty: plausible.io). Only with HOSTED=true and
      // only on /; the server reports the views (src/lib/analytics/), the
      // page loads no script, so the CSP above stays as it is.
      PLAUSIBLE_DOMAIN: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      PLAUSIBLE_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Who runs the instance, named in the footer of every mail
      // (src/lib/mail/footer.ts): name, postal address, contact address and
      // what a business letter of the operator's legal form has to name
      // besides. The address and the legal information take their lines
      // separated by `|`. Name, address and e-mail are required with
      // HOSTED=true; elsewhere a gap is logged at start-up
      // (parseOperatorDetails in scripts/instance-config.mjs).
      OPERATOR_NAME: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      OPERATOR_ADDRESS: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      OPERATOR_EMAIL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      OPERATOR_LEGAL_INFO: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Without SMTP_HOST, development writes mails to the server log instead
      // of sending them; a production build refuses to send (see
      // src/lib/mail/mailer.ts)
      SMTP_HOST: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      SMTP_PORT: envField.number({
        context: 'server',
        access: 'secret',
        default: 587,
      }),
      SMTP_USER: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      SMTP_PASSWORD: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      SMTP_FROM: envField.string({
        context: 'server',
        access: 'secret',
        default: 'Kibo <kibo@localhost>',
      }),
      // Implicit TLS from the first byte. Unset means "port 465 only", which
      // is the usual convention.
      SMTP_SECURE: envField.boolean({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      // Escape hatch for a local Mailpit: allows an unencrypted session and
      // untrusted certificates. Everything else requires STARTTLS.
      SMTP_ALLOW_INSECURE: envField.boolean({
        context: 'server',
        access: 'secret',
        default: false,
      }),
      // Imprint and privacy policy: either an external address (the page then
      // redirects there) or a Markdown file in LEGAL_DIR. Every mail links
      // both, so an address has to be complete and https:// (parseLegalUrl)
      IMPRESSUM_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      DATENSCHUTZ_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      LEGAL_DIR: envField.string({
        context: 'server',
        access: 'secret',
        default: './legal',
      }),
      // The terms and the data processing agreement of the hosted instance,
      // the same way: an external address, or agb.md / avv.md in LEGAL_DIR.
      // Without HOSTED neither page exists. The mail that confirms an
      // agreement links them, so an address is held to the same rule.
      AGB_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      AVV_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: '',
      }),
      // Web push for new notes: all three or none (scripts/server.mjs
      // checks). Unset, the feature is off. The public key is the base64url
      // P-256 point, the private key its JWK — both as printed by
      // `bunx @pushforge/builder vapid`, see
      // docs/selbst-hosten/benachrichtigungen.md.
      VAPID_PUBLIC_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      VAPID_PRIVATE_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      VAPID_SUBJECT: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
})
