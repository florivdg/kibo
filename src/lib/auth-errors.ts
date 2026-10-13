import {
  HOSTED_PAUSED_ADMIN,
  KITA_CREATION_MESSAGES,
  TERMS_NOT_ACCEPTED,
  TERMS_VERSION_CHANGED,
} from '@/lib/hosted/messages'
import {
  ACCOUNT_NAME_MAX,
  INVITATION_LIMIT,
  kitaLimitMessage,
  MEMBERSHIP_LIMIT,
  ORGANIZATION_LIMIT,
  ORGANIZATION_NAME_MAX,
  PASSKEY_NAME_MAX,
  PASSKEYS_PER_ACCOUNT,
  PASSWORD_MIN_LENGTH,
} from '@/lib/limits'

const OWNER_ONLY = 'Nur die Inhaberin oder der Inhaber der Kita kann das.'
const INVITATION_GONE =
  'Diese Einladung ist abgelaufen oder wurde zurückgezogen.'
const CONFIRM_EMAIL_FIRST = 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.'
const PASSKEY_NEEDS_VERIFICATION =
  'Der Passkey muss Sie bestätigen (Fingerabdruck, Gesicht oder PIN). Bitte verwenden Sie einen Passkey mit Bestätigung.'
const PASSKEY_NOT_CHECKED =
  'Der Passkey konnte nicht geprüft werden. Bitte versuchen Sie es erneut.'

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-Mail-Adresse oder Passwort ist falsch.',
  INVALID_EMAIL: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
  INVALID_PASSWORD: 'Das Passwort ist falsch.',
  USER_ALREADY_EXISTS: 'Für diese E-Mail-Adresse gibt es bereits ein Konto.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Für diese E-Mail-Adresse gibt es bereits ein Konto.',
  // The server's own name check on sign-up
  INVALID_NAME: `Bitte geben Sie Ihren Namen ein (höchstens ${ACCOUNT_NAME_MAX} Zeichen, ohne Links).`,
  PASSWORD_TOO_SHORT: `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`,
  PASSWORD_TOO_LONG: 'Das Passwort ist zu lang.',
  // What this instance allows (src/lib/signup-rules.ts)
  SIGNUP_CLOSED: 'Die Registrierung ist auf dieser Instanz geschlossen.',
  EMAIL_DOMAIN_NOT_ALLOWED:
    'E-Mail-Adressen dieser Domain sind auf dieser Instanz nicht zugelassen. Bitte verwenden Sie eine Adresse Ihrer Einrichtung.',
  EMAIL_NOT_VERIFIED: CONFIRM_EMAIL_FIRST,
  EMAIL_ALREADY_VERIFIED: 'Diese E-Mail-Adresse ist bereits bestätigt.',
  INVALID_TOKEN:
    'Dieser Link ist ungültig oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.',
  TOKEN_EXPIRED:
    'Dieser Link ist abgelaufen. Bitte fordern Sie einen neuen an.',
  USER_NOT_FOUND: 'Zu dieser E-Mail-Adresse gibt es kein Konto.',
  INVALID_CODE: 'Der Code ist ungültig.',
  INVALID_BACKUP_CODE: 'Der Backup-Code ist ungültig.',
  // The per-account sign-in budget (Better Auth's own limit has no code)
  TOO_MANY_REQUESTS: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.',
  // Two-factor lockout after repeated wrong codes (answered with 429)
  ACCOUNT_TEMPORARILY_LOCKED:
    'Zu viele Fehlversuche. Bitte warten Sie einige Minuten.',
  EMAIL_CAN_NOT_BE_UPDATED:
    'Die E-Mail-Adresse kann gerade nicht geändert werden. Bitte versuchen Sie es später erneut.',
  CREDENTIAL_ACCOUNT_NOT_FOUND:
    'Für dieses Konto ist kein Passwort hinterlegt.',
  SESSION_NOT_FRESH:
    'Bitte melden Sie sich erneut an, um diese Änderung vorzunehmen.',
  // Links of an address change (see requireSessionForEmailChange in auth.ts)
  EMAIL_CHANGE_NEEDS_SESSION:
    'Sie sind jetzt angemeldet. Bitte öffnen Sie den Link aus der E-Mail an Ihre neue Adresse noch einmal in diesem Browser.',
  INVALID_USER:
    'Dieser Link gehört zu einem anderen Konto. Bitte melden Sie sich mit dem Konto an, dessen Adresse geändert werden soll.',
  SESSION_EXPIRED:
    'Bitte melden Sie sich erneut an, um diese Änderung vorzunehmen.',
  INVALID_TWO_FACTOR_COOKIE:
    'Die Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.',
  // Passkeys: the plugin's codes, the ones of the browser's ceremony
  // (@simplewebauthn/browser) and Kibo's own checks (src/lib/passkeys/rules.ts,
  // checkPasskeyRegistration in auth.ts)
  PASSKEY_NOT_FOUND:
    'Dieser Passkey ist für kein Konto hinterlegt. Melden Sie sich mit Ihrem Passwort an und richten Sie ihn neu ein.',
  AUTHENTICATION_FAILED: PASSKEY_NOT_CHECKED,
  FAILED_TO_VERIFY_REGISTRATION: PASSKEY_NOT_CHECKED,
  CHALLENGE_NOT_FOUND:
    'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es noch einmal.',
  PASSKEY_USER_VERIFICATION_REQUIRED: PASSKEY_NEEDS_VERIFICATION,
  // The browser found no authenticator that could ask for it
  ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT:
    PASSKEY_NEEDS_VERIFICATION,
  INVALID_PASSKEY_NAME: `Bitte geben Sie eine gültige Bezeichnung ein (höchstens ${PASSKEY_NAME_MAX} Zeichen, keine Steuerzeichen).`,
  PASSKEY_LIMIT_REACHED: `Ein Konto kann höchstens ${PASSKEYS_PER_ACCOUNT} Passkeys haben. Bitte entfernen Sie zuerst einen.`,
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    'Dieser Passkey ist bereits hinterlegt.',
  // Kitas: the organization plugin's limit and the server's name checks
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS:
    kitaLimitMessage(ORGANIZATION_LIMIT),
  // The hosted instance counts by the account's subscription instead
  // (src/lib/hosted/kita-limit.ts)
  ...KITA_CREATION_MESSAGES,
  // … and asks for the terms before the first Kita (checkKitaCreation in
  // auth.ts), in the version the form showed
  TERMS_NOT_ACCEPTED,
  TERMS_VERSION_CHANGED,
  INVALID_ORGANIZATION_NAME: `Bitte geben Sie einen gültigen Namen ein (höchstens ${ORGANIZATION_NAME_MAX} Zeichen, keine Steuerzeichen).`,
  INVALID_ORGANIZATION_SLUG:
    'Aus diesem Namen lässt sich keine Kita anlegen. Bitte wählen Sie einen anderen.',
  // Said when a Kita is created or renamed — and when one that was named
  // before this was checked tries to invite (checkInvitationRequest in auth.ts)
  ORGANIZATION_NAME_LOOKS_LIKE_LINK:
    'Der Name der Kita darf keinen Link enthalten. Bitte wählen Sie einen anderen Namen.',
  // What only the owner of a Kita may do (src/lib/organization-roles.ts)
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: OWNER_ONLY,
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: OWNER_ONLY,
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: OWNER_ONLY,
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: OWNER_ONLY,
  // Inviting: Kibo's own checks (checkInvitationRequest in auth.ts) …
  INVALID_INVITATION_ROLE:
    'Eingeladene Personen verwalten die Kita als Admin mit. Eine andere Rolle lässt sich nicht vergeben.',
  TOO_MANY_INVITATIONS:
    'Gerade können keine weiteren Einladungen verschickt werden. Bitte versuchen Sie es später noch einmal.',
  // … and the organization plugin's
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    'Diese Person verwaltet die Kita bereits mit.',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    'Diese Adresse ist bereits eingeladen.',
  INVITATION_LIMIT_REACHED: `Eine Kita kann höchstens ${INVITATION_LIMIT} offene Einladungen haben. Bitte ziehen Sie eine zurück.`,
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: `Eine Kita können höchstens ${MEMBERSHIP_LIMIT} Personen verwalten.`,
  // Answering an invitation
  INVITATION_NOT_FOUND: INVITATION_GONE,
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    'Diese Einladung gilt für eine andere E-Mail-Adresse. Melden Sie sich mit dem eingeladenen Konto an.',
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    CONFIRM_EMAIL_FIRST,
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION: CONFIRM_EMAIL_FIRST,
  // Members
  MEMBER_NOT_FOUND:
    'Diese Person gehört nicht mehr zur Kita. Bitte laden Sie die Seite neu.',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    'Als Inhaberin oder Inhaber können Sie die Kita nicht verlassen.',
  // Astro action error codes
  UNAUTHORIZED: 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
  FORBIDDEN: 'Sie haben keinen Zugriff auf diese Kita.',
  // A board action of a Kita the hosted instance has paused
  PAYMENT_REQUIRED: HOSTED_PAUSED_ADMIN,
  NOT_FOUND:
    'Das wurde nicht gefunden. Vielleicht wurde es gerade gelöscht. Bitte laden Sie die Seite neu.',
}

// Checked in the browser before a new password is sent
export const PASSWORD_MISMATCH = 'Die beiden Passwörter stimmen nicht überein.'

// Set on the login page after a reset, which asks to sign in afresh
export const PASSWORD_RESET_MARKER = 'passwordReset'

export function authErrorMessage(error: {
  code?: string
  status?: number
}): string {
  // A known code says more than the status, e.g. how long a lockout lasts
  const known =
    error.code && Object.hasOwn(MESSAGES, error.code)
      ? MESSAGES[error.code]
      : undefined
  if (known) return known
  if (error.status === 429) {
    return 'Zu viele Versuche. Bitte warten Sie einen Moment.'
  }
  return 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.'
}
