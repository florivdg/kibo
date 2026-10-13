import { describe, expect, test } from 'bun:test'

import { adminNavigation } from '@/lib/admin-nav'
import { authErrorMessage } from '@/lib/auth-errors'
import { HOSTED_ORGANIZATION_CAP } from '@/lib/limits'
import { qrCodeSvg, qrCodeSvgFile } from '@/lib/qr-code'

const FALLBACK = 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.'

describe('authErrorMessage', () => {
  test('a known code wins over the rate-limit status', () => {
    expect(
      authErrorMessage({ code: 'ACCOUNT_TEMPORARILY_LOCKED', status: 429 }),
    ).toBe('Zu viele Fehlversuche. Bitte warten Sie einige Minuten.')
  })

  test('an unknown or empty code falls back by status', () => {
    expect(authErrorMessage({ code: '', status: 429 })).toBe(
      'Zu viele Versuche. Bitte warten Sie einen Moment.',
    )
    expect(authErrorMessage({ code: '' })).toBe(FALLBACK)
    expect(authErrorMessage({})).toBe(FALLBACK)
  })

  // What the hosted instance answers (src/lib/hosted/)
  test('knows the codes of a paused Kita and of the Kita limit', () => {
    expect(authErrorMessage({ code: 'PAYMENT_REQUIRED', status: 402 })).toBe(
      'Das Abo dieser Kita ist pausiert. Bretter lassen sich erst wieder bearbeiten, wenn es verlängert wurde.',
    )
    expect(authErrorMessage({ code: 'HOSTED_TRIAL_ONE_KITA' })).toBe(
      'In der Testphase lässt sich eine Kita anlegen. Weitere Kitas gibt es mit dem Abo.',
    )
    expect(authErrorMessage({ code: 'HOSTED_SUBSCRIPTION_INACTIVE' })).toBe(
      'Das Abo ist abgelaufen oder pausiert. Solange lassen sich keine weiteren Kitas anlegen. Wie es weitergeht, steht unter „Abo“.',
    )
    expect(authErrorMessage({ code: 'HOSTED_KITA_LIMIT' })).toBe(
      `Mit einem Konto lassen sich höchstens ${HOSTED_ORGANIZATION_CAP} Kitas anlegen.`,
    )
  })

  // What the hosted instance asks before the first Kita
  test('knows the code of the terms', () => {
    expect(authErrorMessage({ code: 'TERMS_NOT_ACCEPTED', status: 400 })).toBe(
      'Bitte stimmen Sie den AGB und dem Vertrag zur Auftragsverarbeitung zu.',
    )
  })

  test('ignores names inherited from Object.prototype', () => {
    expect(authErrorMessage({ code: 'toString' })).toBe(FALLBACK)
    expect(authErrorMessage({ code: 'constructor' })).toBe(FALLBACK)
  })
})

// What the sidebar lists under „Verwaltung“
describe('adminNavigation', () => {
  const titles = (hosted: boolean) =>
    adminNavigation('/admin', { hosted }).map((item) => item.title)

  test('has no „Abo“ on an instance somebody hosts for themselves', () => {
    expect(titles(false)).toEqual([
      'Dashboard',
      'Bretter',
      'Meldungen',
      'Kita-Einstellungen',
    ])
  })

  test('has „Abo“ on the hosted instance, leading to its page', () => {
    expect(titles(true)).toEqual([
      'Dashboard',
      'Bretter',
      'Meldungen',
      'Kita-Einstellungen',
      'Abo',
    ])
    expect(adminNavigation('/admin', { hosted: true }).at(-1)).toEqual({
      id: 'subscription',
      title: 'Abo',
      url: '/admin/abo',
      current: undefined,
    })
  })

  test('marks the page somebody is on', () => {
    const active = (path: string) =>
      adminNavigation(path, { hosted: true })
        .filter((item) => item.current)
        .map((item) => item.id)
    expect(active('/admin')).toEqual(['dashboard'])
    expect(active('/admin/')).toEqual(['dashboard'])
    expect(active('/admin/abo')).toEqual(['subscription'])
    expect(active('/admin/abo/')).toEqual(['subscription'])
    expect(active('/admin/kita')).toEqual(['kita'])
    // The boards are a section with pages of its own
    expect(active('/admin/boards')).toEqual(['boards'])
    expect(active('/admin/boards/abc')).toEqual(['boards'])
    // So are the reports
    expect(active('/admin/reports')).toEqual(['reports'])
    expect(active('/admin/reports/abc')).toEqual(['reports'])
    expect(active('/admin/account')).toEqual([])
  })

  test('says whether it is the page itself or one within its section', () => {
    const current = (path: string, id: string) =>
      adminNavigation(path, { hosted: true }).find((item) => item.id === id)
        ?.current
    expect(current('/admin', 'dashboard')).toBe('page')
    expect(current('/admin/boards/', 'boards')).toBe('page')
    expect(current('/admin/boards/abc', 'boards')).toBe('true')
    expect(current('/admin/reports/abc', 'reports')).toBe('true')
  })
})

describe('qrCodeSvgFile', () => {
  test('gives the file the size of its viewBox', () => {
    const svg = qrCodeSvg('https://kibo.example/k/abcdefghijklmnopqrstuv/')
    const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? []
    expect(qrCodeSvgFile(svg)).toStartWith(
      `<svg width="${width}" height="${height}" `,
    )
  })
})
