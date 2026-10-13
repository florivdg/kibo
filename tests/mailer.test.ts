import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { sendMail } from '@/lib/mail/mailer'

// The mailer without a mail server (src/lib/mail/mailer.ts): the tests have
// no SMTP_HOST and are no dev server, which is what a production build
// without one looks like. Nothing is sent, and the log says so.
let info: ReturnType<typeof spyOn>
let error: ReturnType<typeof spyOn>

const logged = (spy: ReturnType<typeof spyOn>): string[] =>
  spy.mock.calls.map((call: unknown[]) => String(call[0]))

beforeEach(() => {
  info = spyOn(console, 'info').mockImplementation(() => {})
  error = spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  info.mockRestore()
  error.mockRestore()
})

const mail = {
  to: 'betrieb@kibo.example',
  subject: 'Rechnungsanfrage von owner@example.org',
  text: 'Konto: owner@example.org\nhttps://kibo.example/geheim',
  html: '<p>Konto: owner@example.org</p>',
}

describe('sendMail', () => {
  // Whoever depends on the mail having gone out asks
  // (src/lib/hosted/reminders.ts)
  test('says that a mail did not go out instead of throwing', async () => {
    expect(await sendMail(mail)).toBe(false)
  })

  test('logs the failure without a full address, in front or in the subject', async () => {
    await sendMail(mail)
    expect(logged(error)).toEqual([
      '[mail] Versand an b***@kibo.example fehlgeschlagen ' +
        '(Rechnungsanfrage von o***@example.org): ' +
        'SMTP ist nicht konfiguriert (SMTP_HOST fehlt)',
    ])
    // Never the mail itself: a production build logs no body and no link
    expect(logged(info)).toEqual([])
  })

  test('leaves a subject without an address as it is', async () => {
    await sendMail({ ...mail, subject: 'Ihre Kitas bei Kibo werden gelöscht' })
    expect(logged(error)).toEqual([
      '[mail] Versand an b***@kibo.example fehlgeschlagen ' +
        '(Ihre Kitas bei Kibo werden gelöscht): ' +
        'SMTP ist nicht konfiguriert (SMTP_HOST fehlt)',
    ])
  })
})
