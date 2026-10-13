import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { effectScope, nextTick } from 'vue'

import { useOwnNoteKeys } from '@/composables/use-own-note-keys'
import { useSeenBoards } from '@/composables/use-seen-boards'
import { liveOwnNotes } from '@/lib/board/own-notes'
import type { Note } from '@/lib/board/types'

// What the board pages keep in the browser's localStorage
// (src/composables/use-device-record.ts): nothing until there is something to
// keep, and no delete key of a note that has expired. A window of its own
// stands in for the browser's, with a localStorage that records each write.

const DAY = 24 * 60 * 60 * 1000
const at = (offset: number) => new Date(Date.now() + offset).toISOString()

class FakeStorage {
  readonly items = new Map<string, string>()
  readonly writes: string[] = []
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.writes.push(key)
    this.items.set(key, value)
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

// VueUse checks `instanceof Storage` and announces writes with a
// StorageEvent, neither of which the test runner has
beforeAll(() => {
  Object.assign(globalThis, {
    Storage: FakeStorage,
    StorageEvent: class extends Event {
      constructor(type: string, init: object) {
        super(type)
        Object.assign(this, init)
      }
    },
  })
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'Storage')
  Reflect.deleteProperty(globalThis, 'StorageEvent')
})

function fakeWindow(items: Record<string, unknown> = {}) {
  const storage = new FakeStorage()
  for (const [key, value] of Object.entries(items)) {
    storage.items.set(key, JSON.stringify(value))
  }
  const window = Object.assign(new EventTarget(), { localStorage: storage })
  return { storage, window: window as unknown as Window }
}

// Outside a component the record is read right away (tryOnMounted)
const scopes: ReturnType<typeof effectScope>[] = []
function inScope<T>(run: () => T) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(run)!
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

const note = (id: string, expiresAt: string) => ({ id, expiresAt }) as Note

describe('the delete keys of own notes', () => {
  test('nothing is written before a note is pinned', async () => {
    const { storage, window } = fakeWindow()
    const keys = inScope(() => useOwnNoteKeys(window))
    await nextTick()
    expect(keys.keyFor('a')).toBeUndefined()
    expect(storage.writes).toEqual([])
    expect(storage.items.size).toBe(0)

    const expiresAt = at(DAY)
    keys.add(note('a', expiresAt), 'key-a')
    await nextTick()
    expect(JSON.parse(storage.getItem('kibo:own-notes')!)).toEqual({
      a: { key: 'key-a', expiresAt },
    })
    expect(keys.keyFor('a')).toBe('key-a')

    // The last key taken down takes the entry along
    keys.remove('a')
    await nextTick()
    expect(storage.getItem('kibo:own-notes')).toBeNull()
  })

  test('keys of expired notes go as soon as the record is read', async () => {
    const live = { key: 'live', expiresAt: at(DAY) }
    const { storage, window } = fakeWindow({
      'kibo:own-notes': { gone: { key: 'gone', expiresAt: at(-1000) }, live },
    })
    const keys = inScope(() => useOwnNoteKeys(window))
    await nextTick()
    expect(keys.keyFor('gone')).toBeUndefined()
    expect(keys.keyFor('live')).toBe('live')
    expect(JSON.parse(storage.getItem('kibo:own-notes')!)).toEqual({ live })
  })

  test('a record of expired keys only is removed', async () => {
    const { storage, window } = fakeWindow({
      'kibo:own-notes': { gone: { key: 'gone', expiresAt: at(-1000) } },
    })
    inScope(() => useOwnNoteKeys(window))
    await nextTick()
    expect(storage.getItem('kibo:own-notes')).toBeNull()
    expect(storage.writes).toEqual([])
  })

  test('liveOwnNotes keeps what still hangs, and nothing becomes null', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    const live = { key: 'b', expiresAt: '2026-05-05T10:00:00.000Z' }
    const own = {
      a: { key: 'a', expiresAt: '2026-05-04T10:00:00.000Z' },
      b: live,
    }
    expect(liveOwnNotes(own, now)).toEqual({ b: live })
    expect(liveOwnNotes({ a: own.a }, now)).toBeNull()
    expect(liveOwnNotes(null, now)).toBeNull()
  })
})

describe('the visits for the „Neu“ marker', () => {
  test('nothing is written before a board is opened', async () => {
    const { storage, window } = fakeWindow()
    const seen = inScope(() => useSeenBoards(window))
    await nextTick()
    expect(storage.writes).toEqual([])

    seen.markSeen('board', '2026-05-04T10:00:00.000Z')
    await nextTick()
    expect(JSON.parse(storage.getItem('kibo:seen')!)).toEqual({
      board: '2026-05-04T10:00:00.000Z',
    })
  })
})
