import {
  SMTP_ALLOW_INSECURE,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} from 'astro:env/server'
import { createTransport, type Transporter } from 'nodemailer'

import { maskAddress, smtpTransportOptions } from '@/lib/mail/transport-options'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

// Built on first use so importing this module doesn't open a connection pool
let transport: Transporter | null | undefined

function mailTransport() {
  if (transport !== undefined) return transport
  transport = SMTP_HOST
    ? createTransport(
        smtpTransportOptions({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          allowInsecure: SMTP_ALLOW_INSECURE,
          user: SMTP_USER,
          password: SMTP_PASSWORD,
        }),
      )
    : null
  return transport
}

// Printed once at start-up so a missing or surprising SMTP setup is visible
// before the first user misses a mail
export function logMailConfiguration() {
  if (SMTP_HOST) {
    console.info(`[mail] SMTP ${SMTP_HOST}:${SMTP_PORT}`)
  } else if (import.meta.env.DEV) {
    console.info('[mail] Kein SMTP_HOST – E-Mails werden nur protokolliert')
  } else {
    console.error(
      '[mail] SMTP_HOST fehlt: Kibo kann keine E-Mails versenden. ' +
        'Registrierung und Passwort-Reset funktionieren dadurch nicht.',
    )
  }
}

// Anything shaped like an address, e.g. in "550 5.1.1 <name@example.org>:
// Recipient address rejected"
const ADDRESS_IN_TEXT = /[^\s<>"'():;,]+@[^\s<>"'():;,]+/g

// Keeps the diagnosis useful without the mail itself: no body, no link, no
// full address — not the recipient's, and not one the subject names
function logFailure(mail: Mail, reason: string) {
  const subject = mail.subject.replace(ADDRESS_IN_TEXT, maskAddress)
  console.error(
    `[mail] Versand an ${maskAddress(mail.to)} fehlgeschlagen ` +
      `(${subject}): ${reason}`,
  )
}

// nodemailer's code (EENVELOPE, EAUTH, ETIMEDOUT …) and the SMTP reply code
// say what went wrong. The text of the server's reply often repeats the
// recipient, so every address in it is masked like the one in front.
function reason(error: unknown) {
  if (!(error instanceof Error)) return 'unbekannter Fehler'
  const codes = [Reflect.get(error, 'code'), Reflect.get(error, 'responseCode')]
    .filter((code) => typeof code === 'string' || typeof code === 'number')
    .join(' ')
  const message = error.message.replace(ADDRESS_IN_TEXT, maskAddress)
  return codes ? `${codes} ${message}` : message
}

// Better Auth awaits this inside sign-up and password reset requests. A bounced
// mail must not fail those: the account is already created, and password reset
// answers the same way for known and unknown addresses on purpose. Users get a
// second chance through "E-Mail erneut senden" and "Passwort vergessen".
//
// So this never throws, and says instead whether the mail was handed to the
// mail server: false when that failed or there is none to hand it to. Whoever
// depends on the mail having gone out asks (src/lib/hosted/reminders.ts).
export async function sendMail(mail: Mail): Promise<boolean> {
  const smtp = mailTransport()
  if (!smtp) {
    // Confirmation and reset links are bearer tokens: logging them is a
    // development convenience a production build must never take.
    // A mail in the log has reached nobody, so it doesn't count as handed
    // over either — no deletion is announced by it (hosted/reminders.ts).
    if (import.meta.env.DEV) {
      console.info(`[mail] ${mail.to}: ${mail.subject}\n${mail.text}`)
      return false
    }
    logFailure(mail, 'SMTP ist nicht konfiguriert (SMTP_HOST fehlt)')
    return false
  }
  try {
    await smtp.sendMail({ from: SMTP_FROM, ...mail })
    return true
  } catch (error) {
    logFailure(mail, reason(error))
    return false
  }
}
