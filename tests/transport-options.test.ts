import { describe, expect, test } from 'bun:test'

import { maskAddress, smtpTransportOptions } from '@/lib/mail/transport-options'

const base = { host: 'mail.example.org', port: 587, allowInsecure: false }

describe('smtpTransportOptions', () => {
  test('forces STARTTLS on submission ports', () => {
    const options = smtpTransportOptions(base)
    expect(options.secure).toBe(false)
    expect(options.requireTLS).toBe(true)
    expect(options.ignoreTLS).toBeUndefined()
    expect(options.tls).toMatchObject({ rejectUnauthorized: true })
  })

  test('uses implicit TLS on port 465', () => {
    const options = smtpTransportOptions({ ...base, port: 465 })
    expect(options.secure).toBe(true)
    expect(options.requireTLS).toBeUndefined()
  })

  test('lets SMTP_SECURE override the port convention', () => {
    expect(smtpTransportOptions({ ...base, secure: true }).secure).toBe(true)
    expect(
      smtpTransportOptions({ ...base, port: 465, secure: false }).requireTLS,
    ).toBe(true)
  })

  test('only drops TLS when explicitly allowed (Mailpit)', () => {
    const options = smtpTransportOptions({
      host: 'mailpit',
      port: 1025,
      allowInsecure: true,
    })
    expect(options.secure).toBe(false)
    expect(options.ignoreTLS).toBe(true)
    expect(options.requireTLS).toBeUndefined()
  })

  test('sends credentials only with a user', () => {
    expect(smtpTransportOptions(base).auth).toBeUndefined()
    expect(
      smtpTransportOptions({ ...base, user: 'kibo', password: 'secret' }).auth,
    ).toEqual({ user: 'kibo', pass: 'secret' })
  })
})

describe('maskAddress', () => {
  test('keeps the first character and the domain', () => {
    expect(maskAddress('leitung@kita.example')).toBe('l***@kita.example')
  })

  test('gives nothing away for unusual addresses', () => {
    expect(maskAddress('@kita.example')).toBe('***')
    expect(maskAddress('kaputt')).toBe('***')
  })
})
