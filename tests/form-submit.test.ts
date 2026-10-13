import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useFormSubmit } from '@/composables/use-form-submit'

describe('useFormSubmit', () => {
  test('resolves to the result and releases pending on success', async () => {
    const { error, pending, run } = useFormSubmit()
    const result = await run(async () => ({ data: 1, error: null }))
    expect(result?.data).toBe(1)
    expect(pending.value).toBe(false)
    expect(error.value).toBeNull()
  })

  test('records the message and code of a failed call', async () => {
    const { error, errorCode, pending, run } = useFormSubmit(
      ({ code }) => `failed: ${code}`,
    )
    const result = await run(async () => ({ error: { code: 'NOPE' } }))
    expect(result).toBeUndefined()
    expect(error.value).toBe('failed: NOPE')
    expect(errorCode.value).toBe('NOPE')
    expect(pending.value).toBe(false)
  })

  test('records a refusal of the form itself, until the next call', async () => {
    const { error, errorCode, refuse, run } = useFormSubmit(() => 'failed')
    await run(async () => ({ error: { code: 'NOPE' } }))
    refuse('MISMATCH', 'mismatch')
    expect(error.value).toBe('mismatch')
    expect(errorCode.value).toBe('MISMATCH')
    await run(async () => ({ error: null }))
    expect(error.value).toBeNull()
    expect(errorCode.value).toBeNull()
  })

  test('treats a rejected call as a failure', async () => {
    const { error, pending, run } = useFormSubmit(() => 'offline')
    const result = await run(() => Promise.reject(new Error('network')))
    expect(result).toBeUndefined()
    expect(error.value).toBe('offline')
    expect(pending.value).toBe(false)
  })

  test('drops a call while another one runs', async () => {
    const { pending, run } = useFormSubmit()
    let calls = 0
    const { promise, resolve } = Promise.withResolvers<{ error: null }>()
    const first = run(() => {
      calls++
      return promise
    })
    const second = await run(async () => {
      calls++
      return { error: null }
    })
    expect(second).toBeUndefined()
    expect(pending.value).toBe(true)
    resolve({ error: null })
    expect(await first).toEqual({ error: null })
    expect(calls).toBe(1)
    expect(pending.value).toBe(false)
  })
})

describe('useFormSubmit leaving the page', () => {
  let browser: {
    listeners: string[]
    location: { href: string; reloads: number }
    storage: Map<string, string>
  }

  beforeEach(() => {
    browser = {
      listeners: [],
      location: { href: '/here', reloads: 0 },
      storage: new Map(),
    }
    const { listeners, location, storage } = browser
    globalThis.window = {
      addEventListener: (type: string) => listeners.push(type),
      location: {
        set href(value: string) {
          location.href = value
        },
        reload: () => location.reloads++,
      },
    } as unknown as Window & typeof globalThis
    globalThis.sessionStorage = {
      setItem: (key: string, value: string) => storage.set(key, value),
    } as unknown as Storage
  })

  afterEach(() => {
    // @ts-expect-error: the test runner has no window of its own
    delete globalThis.window
    // @ts-expect-error: nor session storage
    delete globalThis.sessionStorage
  })

  test('navigates after a success and stays pending', async () => {
    const { pending, run } = useFormSubmit()
    await run(async () => ({ error: null }), {
      leave: { href: '/next', toast: 'Gespeichert.' },
    })
    expect(browser.location.href).toBe('/next')
    expect([...browser.storage.values()]).toEqual(['Gespeichert.'])
    expect(pending.value).toBe(true)
    // …until the page comes back from the history cache
    expect(browser.listeners).toEqual(['pageshow'])
  })

  test('reloads, or leaves the navigating to the call', async () => {
    const { pending, run } = useFormSubmit()
    await run(async () => ({ error: null }), { leave: { reload: true } })
    expect(browser.location.reloads).toBe(1)

    const other = useFormSubmit()
    await other.run(async () => ({ error: null }), {
      leave: { redirected: true },
    })
    expect(browser.location).toEqual({ href: '/here', reloads: 1 })
    expect([pending.value, other.pending.value]).toEqual([true, true])
  })

  test('picks the destination from the result', async () => {
    const { pending, run } = useFormSubmit()
    await run(async () => ({ data: { id: 'b1' }, error: null }), {
      leave: ({ data }) => ({ href: `/boards/${data.id}` }),
    })
    expect(browser.location.href).toBe('/boards/b1')
    expect(pending.value).toBe(true)
  })

  test('stays when the destination is undefined', async () => {
    const { pending, run } = useFormSubmit()
    await run(async () => ({ error: null }), { leave: () => undefined })
    expect(browser.location.href).toBe('/here')
    expect(pending.value).toBe(false)
  })

  test('stays after a failure, with the pending state released', async () => {
    const { pending, run } = useFormSubmit(() => 'x')
    await run(async () => ({ error: { code: 'X' } }), {
      leave: { href: '/next', toast: 'Gespeichert.' },
    })
    expect(browser.location.href).toBe('/here')
    expect(browser.storage.size).toBe(0)
    expect(pending.value).toBe(false)
  })
})
