import type TransportOptions from 'nodemailer/lib/smtp-transport'

export interface SmtpConfig {
  host: string
  port: number
  /** Implicit TLS. Unset falls back to the port 465 convention. */
  secure?: boolean
  /** Only for a local Mailpit: no encryption, no certificate check */
  allowInsecure: boolean
  user?: string
  password?: string
}

function auth(config: SmtpConfig) {
  return config.user
    ? { auth: { user: config.user, pass: config.password } }
    : {}
}

// `secure: false` on its own does not force STARTTLS — nodemailer would happily
// keep talking plaintext if the server never offers it. So the transport says
// out loud which of the three cases it is in.
function encryption(config: SmtpConfig) {
  if (config.secure ?? config.port === 465) {
    return { secure: true, tls: { minVersion: 'TLSv1.2' } } as const
  }
  if (config.allowInsecure) {
    // Mailpit speaks neither STARTTLS nor TLS
    return { secure: false, ignoreTLS: true } as const
  }
  return {
    secure: false,
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  } as const
}

export function smtpTransportOptions(
  config: SmtpConfig,
): TransportOptions.Options {
  return {
    host: config.host,
    port: config.port,
    ...encryption(config),
    ...auth(config),
  }
}

// Logs name the recipient only in this shortened form: enough to match a
// support request to a log line, not a mailing list.
export function maskAddress(address: string) {
  const at = address.lastIndexOf('@')
  if (at < 1) return '***'
  return `${address[0]}***${address.slice(at)}`
}
