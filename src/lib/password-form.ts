// The form behind a reset link, in the words that fit the account: `setup`
// for one that has no password yet (a confirmation link led there, or
// "Passwort vergessen" before one was ever set), `reset` for every other.
// The page decides by the token (passwordFormMode in password-setup.ts).
export type PasswordFormMode = 'setup' | 'reset'

export const PASSWORD_FORM_TEXTS: Record<
  PasswordFormMode,
  { title: string; heading: string; description: string }
> = {
  setup: {
    title: 'Passwort festlegen',
    heading: 'Passwort festlegen',
    description:
      'Ihre E-Mail-Adresse ist bestätigt. Legen Sie jetzt das Passwort fest, mit dem Sie sich anmelden.',
  },
  reset: {
    title: 'Neues Passwort',
    heading: 'Neues Passwort vergeben',
    description:
      'Danach melden Sie sich mit dem neuen Passwort an. Hinterlegte Passkeys werden dabei entfernt.',
  },
}
