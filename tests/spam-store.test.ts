import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { note } from '@/db/schema'
import type { Budget } from '@/lib/spam/budgets'
import { normalizeIp } from '@/lib/spam/client-ip'
import { normalizeContent } from '@/lib/spam/content'
import { isValidFormToken, issueFormToken } from '@/lib/spam/form-token'
import { createSpamStore } from '@/lib/spam/store'

import {
  keyIds,
  newNoteId,
  newProcess,
  removeTestBoard,
  resetSpamTables,
  rotateKey,
  testDb,
} from './helpers/spam-db'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// Small stand-ins for the real budgets, so the test says what it checks
const burst: Budget = {
  name: 'test:burst',
  subject: 'client',
  windowMs: 5 * MINUTE,
  max: 3,
}
const daily: Budget = {
  name: 'test:daily',
  subject: 'client',
  windowMs: 24 * HOUR,
  max: 4,
}

// Sliding version of the burst budget, the way the real note budgets are set
const sliding: Budget = {
  name: 'test:sliding',
  subject: 'client',
  windowMs: 5 * MINUTE,
  max: 3,
  sliding: true,
}

const start = new Date('2026-05-04T10:00:00.000Z')
const at = (ms: number) => new Date(start.getTime() + ms)

beforeEach(resetSpamTables)
afterAll(removeTestBoard)

async function consumeTimes(
  store: ReturnType<typeof newProcess>,
  times: number,
  subject: string,
  budgets: Budget[] = [burst],
  now = start,
) {
  const results = []
  for (let i = 0; i < times; i++) {
    results.push(await store.consume(budgets, { client: subject }, now))
  }
  return results
}

describe('budget limits', () => {
  test('allows exactly the configured number of attempts', async () => {
    const store = newProcess()
    const results = await consumeTimes(store, 4, 'ip4:203.0.113.7')
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results[3]!.retryAfterMs).toBeGreaterThan(0)
    expect(results[3]!.retryAfterMs).toBeLessThanOrEqual(burst.windowMs)
  })

  test('keeps budgets of different subjects apart', async () => {
    const store = newProcess()
    await consumeTimes(store, 3, 'ip4:203.0.113.7')
    const other = await store.consume(
      [burst],
      { client: 'ip4:198.51.100.1' },
      start,
    )
    expect(other.allowed).toBe(true)
  })

  test('the strictest budget decides, and the longer one keeps counting', async () => {
    const store = newProcess()
    const budgets = [burst, daily]
    await consumeTimes(store, 3, 'ip4:203.0.113.7', budgets)
    // Blocked by the burst window
    expect(
      (await store.consume(budgets, { client: 'ip4:203.0.113.7' }, start))
        .allowed,
    ).toBe(false)
    // An hour later the burst window is gone, the daily one is not: its four
    // attempts (three allowed, one turned away) are already used up
    const later = at(HOUR)
    const next = await store.consume(
      budgets,
      { client: 'ip4:203.0.113.7' },
      later,
    )
    expect(next.allowed).toBe(false)
    expect(next.retryAfterMs).toBeGreaterThan(HOUR)
  })

  test('a fresh window starts once the old one has run out', async () => {
    const store = newProcess()
    await consumeTimes(store, 4, 'ip4:203.0.113.7')
    const after = await store.consume(
      [burst],
      { client: 'ip4:203.0.113.7' },
      at(burst.windowMs + MINUTE),
    )
    expect(after.allowed).toBe(true)
  })

  test('turned-away attempts do not push the window further out', async () => {
    const store = newProcess()
    // Ten attempts, seven of them refused, still only the original window
    const results = await consumeTimes(store, 10, 'ip4:203.0.113.7')
    expect(results.at(-1)!.retryAfterMs).toBeLessThanOrEqual(burst.windowMs)
    const after = await store.consume(
      [burst],
      { client: 'ip4:203.0.113.7' },
      at(burst.windowMs + MINUTE),
    )
    expect(after.allowed).toBe(true)
  })

  test('parallel requests share one budget', async () => {
    const store = newProcess()
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.consume([burst], { client: 'ip4:203.0.113.7' }, start),
      ),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(burst.max)
  })
})

// M-1: with plain fixed windows a client could spend a full budget just
// before a window ends and another right after — twice the limit in a moment
describe('sliding windows', () => {
  test('a fixed window would hand out a second budget at the border', async () => {
    const store = newProcess()
    const nearEnd = at(burst.windowMs - 1_000)
    const justAfter = at(burst.windowMs + 1_000)
    await consumeTimes(store, 3, 'ip4:203.0.113.7', [burst], nearEnd)
    expect(
      (await store.consume([burst], { client: 'ip4:203.0.113.7' }, justAfter))
        .allowed,
    ).toBe(true)
  })

  test('the sliding budget counts the tail of the window before', async () => {
    const store = newProcess()
    const nearEnd = at(sliding.windowMs - 1_000)
    const justAfter = at(sliding.windowMs + 1_000)
    await consumeTimes(store, 3, 'ip4:198.51.100.5', [sliding], nearEnd)
    expect(
      (
        await store.consume(
          [sliding],
          { client: 'ip4:198.51.100.5' },
          justAfter,
        )
      ).allowed,
    ).toBe(false)
  })

  test('and lets go of it as the new window runs on', async () => {
    const store = newProcess()
    await consumeTimes(store, 3, 'ip4:198.51.100.6', [sliding], start)
    // 80% into the next window only a fifth of the old one still counts
    const late = at(sliding.windowMs + 4 * MINUTE)
    expect(
      (await store.consume([sliding], { client: 'ip4:198.51.100.6' }, late))
        .allowed,
    ).toBe(true)
  })

  test('cleanup keeps the window the lookback still needs', async () => {
    const store = newProcess()
    await consumeTimes(store, 3, 'ip4:198.51.100.7', [sliding], start)
    const justAfter = at(sliding.windowMs + 1_000)
    await store.cleanup(justAfter)
    expect(
      (
        await store.consume(
          [sliding],
          { client: 'ip4:198.51.100.7' },
          justAfter,
        )
      ).allowed,
    ).toBe(false)
  })
})

describe('shared storage', () => {
  test('a second process gets no budget of its own', async () => {
    const first = newProcess()
    const second = newProcess()
    await consumeTimes(first, 2, 'ip4:203.0.113.7')
    await consumeTimes(second, 1, 'ip4:203.0.113.7')
    expect(
      (await second.consume([burst], { client: 'ip4:203.0.113.7' }, start))
        .allowed,
    ).toBe(false)
  })

  test('a restart continues the running budget', async () => {
    const before = newProcess()
    await consumeTimes(before, 3, 'ip4:203.0.113.7')
    // A restart is a new store with nothing in memory
    const after = newProcess()
    expect(
      (await after.consume([burst], { client: 'ip4:203.0.113.7' }, start))
        .allowed,
    ).toBe(false)
  })

  test('rotating the key hands out no extra budget', async () => {
    const store = newProcess()
    await consumeTimes(store, 3, 'ip4:203.0.113.7')
    await rotateKey()
    // Every process picks the new key up
    const rotated = newProcess()
    const next = await rotated.consume(
      [burst],
      { client: 'ip4:203.0.113.7' },
      start,
    )
    expect(next.allowed).toBe(false)
  })

  // A key's counters stop growing when the next key takes over, not when the
  // key was made: one that served for months and was rotated out a minute ago
  // still holds a day of live counters
  test('a key made long ago still counts after it was rotated out', async () => {
    await rotateKey(at(-90 * 24 * HOUR))
    const before = newProcess()
    await consumeTimes(before, 3, 'ip4:203.0.113.7', [daily])
    await rotateKey(at(MINUTE))
    const after = newProcess()
    const next = await after.consume(
      [daily],
      { client: 'ip4:203.0.113.7' },
      at(2 * MINUTE),
    )
    const last = await after.consume(
      [daily],
      { client: 'ip4:203.0.113.7' },
      at(2 * MINUTE),
    )
    expect(next.allowed).toBe(true)
    expect(last.allowed).toBe(false)
  })

  test('addresses in one /64 share the budget even when they change', async () => {
    const store = newProcess()
    const addresses = [
      '2001:db8:1:2::1',
      '2001:db8:1:2::2',
      '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
      '2001:DB8:0001:0002::5',
    ]
    const results = []
    for (const address of addresses) {
      results.push(
        await store.consume([burst], { client: normalizeIp(address)! }, start),
      )
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
  })
})

// What the form tokens are signed with (src/lib/spam/form-token.ts)
describe('signatures', () => {
  test('verify what was signed, and nothing else', async () => {
    const store = newProcess()
    const { keyId, signature } = await store.sign('wert', start)
    expect(await store.verify(keyId, 'wert', signature, start)).toBe(true)
    expect(await store.verify(keyId, 'anders', signature, start)).toBe(false)
    expect(await store.verify(keyId, 'wert', `${signature}x`, start)).toBe(
      false,
    )
    expect(await store.verify('unbekannt', 'wert', signature, start)).toBe(
      false,
    )
  })

  // On the clock of the keys' creation, which the database sets
  test('a key rotated out keeps verifying until it is retired', async () => {
    const now = new Date()
    const later = (ms: number) => new Date(now.getTime() + ms)
    const before = newProcess()
    const { keyId, signature } = await before.sign('wert', now)
    await rotateKey(later(SECOND))
    const after = newProcess()
    expect(
      await after.verify(keyId, 'wert', signature, later(2 * MINUTE)),
    ).toBe(true)
    // Retired a day and more after it was rotated out
    expect(await after.verify(keyId, 'wert', signature, later(26 * HOUR))).toBe(
      false,
    )
  })

  // Another process rotated the key a moment ago, and this one still has
  // the old keys cached
  test('finds a key another process created since it last looked', async () => {
    const now = new Date()
    const cached = newProcess()
    await cached.sign('wert', now)
    await rotateKey(new Date(now.getTime() + SECOND))
    const { keyId, signature } = await newProcess().sign('wert', now)
    expect(
      await cached.verify(
        keyId,
        'wert',
        signature,
        new Date(now.getTime() + 10 * SECOND),
      ),
    ).toBe(true)
  })

  test('accepts a ripe rotated-key token while the old cache is under five seconds old', async () => {
    const now = new Date()
    const later = (ms: number) => new Date(now.getTime() + ms)
    const cached = newProcess()
    await cached.sign('warm-cache', now)
    await rotateKey(later(SECOND))
    const token = await issueFormToken(newProcess(), 'board', later(SECOND))
    expect(
      await isValidFormToken(cached, token, 'board', later(4 * SECOND)),
    ).toBe(true)
  })

  // A store whose key reads are counted, and fail while `down` is set
  function countingStore() {
    const counted = { reads: 0, down: false }
    const counting = new Proxy(testDb, {
      get(target, property, receiver) {
        if (property === 'select') {
          counted.reads += 1
          if (counted.down) throw new Error('Datenbank weg')
        }
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    return { store: createSpamStore(counting), counted }
  }

  // A forged signature under a key the process knows costs no query; a
  // made-up key id one at most every few seconds
  test('reads the keys again only for an unknown key id, and rarely', async () => {
    const { store, counted } = countingStore()
    const at = (ms: number) => new Date(start.getTime() + ms)
    const { keyId, signature } = await store.sign('wert', start)
    counted.reads = 0
    const forged = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    expect(await store.verify(keyId, 'wert', forged, at(10 * SECOND))).toBe(
      false,
    )
    expect(counted.reads).toBe(0)
    for (const ms of [10, 11, 14].map((s) => s * SECOND)) {
      expect(await store.verify('erfunden', 'wert', signature, at(ms))).toBe(
        false,
      )
    }
    expect(counted.reads).toBe(1)
    expect(
      await store.verify('erfunden', 'wert', signature, at(16 * SECOND)),
    ).toBe(false)
    expect(counted.reads).toBe(2)
  })

  // Parallel unknown-key refreshes, with a recent or expired ordinary cache
  test.each([2 * SECOND, 2 * MINUTE])(
    'parallel verifications share one key read at %i ms',
    async (ms) => {
      const { store, counted } = countingStore()
      const { signature } = await store.sign('wert', start)
      counted.reads = 0
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.verify('erfunden', 'wert', signature, at(ms)),
        ),
      )
      expect(results).toEqual(Array.from({ length: 8 }, () => false))
      expect(counted.reads).toBe(1)
    },
  )

  // While the database is away a made-up key id still fails as unavailable,
  // without asking it again for every request
  test('a failed key read is not repeated for a few seconds', async () => {
    const { store, counted } = countingStore()
    const { signature } = await store.sign('wert', start)
    counted.reads = 0
    counted.down = true
    const failure = (verified: Promise<boolean>) =>
      verified.then(
        () => undefined,
        (error: Error) => error.message,
      )
    const verify = (s: number) =>
      store.verify('erfunden', 'wert', signature, at(s * SECOND))
    expect(await failure(verify(10))).toBe('Datenbank weg')
    expect(counted.reads).toBe(1)
    expect(await failure(verify(12))).toBe('Datenbank weg')
    expect(counted.reads).toBe(1)
    counted.down = false
    expect(await verify(16)).toBe(false)
    expect(counted.reads).toBe(2)
  })
})

describe('duplicate detection', () => {
  const text = normalizeContent(['Fahrrad abzugeben', 'Läuft noch prima!'])

  test('catches the same note again inside the window', async () => {
    const store = newProcess()
    const claim = (id: string) =>
      store.claimContent('note|b1', text, id, HOUR, start)
    expect(await claim(await newNoteId())).toBe(true)
    expect(await claim(await newNoteId())).toBe(false)
  })

  test('only one of a set of parallel duplicates gets through', async () => {
    const store = newProcess()
    const ids = await Promise.all(Array.from({ length: 8 }, () => newNoteId()))
    const results = await Promise.all(
      ids.map((id) => store.claimContent('note|b1', text, id, HOUR, start)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test('separates boards and allows the repeat later on', async () => {
    const store = newProcess()
    await store.claimContent('note|b1', text, await newNoteId(), HOUR, start)
    expect(
      await store.claimContent('note|b2', text, await newNoteId(), HOUR, start),
    ).toBe(true)
    expect(
      await store.claimContent(
        'note|b1',
        text,
        await newNoteId(),
        HOUR,
        at(HOUR + MINUTE),
      ),
    ).toBe(true)
  })

  test('sees through spacing, case and punctuation', async () => {
    const store = newProcess()
    const variant = normalizeContent([
      '  FAHRRAD   abzugeben!! ',
      'Läuft noch prima …',
    ])
    expect(
      await store.claimContent('note|b1', text, await newNoteId(), HOUR, start),
    ).toBe(true)
    expect(
      await store.claimContent(
        'note|b1',
        variant,
        await newNoteId(),
        HOUR,
        start,
      ),
    ).toBe(false)
  })

  test('a rotated key does not forget a live duplicate', async () => {
    const store = newProcess()
    await store.claimContent('note|b1', text, await newNoteId(), HOUR, start)
    await rotateKey()
    const rotated = newProcess()
    expect(
      await rotated.claimContent(
        'note|b1',
        text,
        await newNoteId(),
        HOUR,
        start,
      ),
    ).toBe(false)
  })

  // The claim hangs off the note by a foreign key, so anyone removing the note
  // frees the text — no bookkeeping in the application
  test('removing the note frees the text again', async () => {
    const store = newProcess()
    const id = await newNoteId()
    expect(await store.claimContent('note|b1', text, id, HOUR, start)).toBe(
      true,
    )
    await testDb.delete(note).where(eq(note.id, id))
    expect(
      await store.claimContent('note|b1', text, await newNoteId(), HOUR, start),
    ).toBe(true)
  })
})

describe('cleanup', () => {
  test('drops counters and fingerprints once their window has passed', async () => {
    const store = newProcess()
    await consumeTimes(store, 2, 'ip4:203.0.113.7')
    await store.claimContent(
      'note|b1',
      'etwas',
      await newNoteId(),
      MINUTE,
      start,
    )
    // Well past the grace period the sliding budgets look back over
    await store.cleanup(at(3 * HOUR))
    // Everything is gone, so the budget starts over
    const fresh = newProcess()
    const results = await consumeTimes(fresh, 3, 'ip4:203.0.113.7')
    expect(results.every((r) => r.allowed)).toBe(true)
  })

  test('keeps a retired key for a day after it was superseded', async () => {
    const old = await rotateKey(at(-90 * 24 * HOUR))
    const current = await rotateKey(at(MINUTE))
    const store = newProcess()
    await store.cleanup(at(2 * MINUTE))
    expect(await keyIds()).toEqual(expect.arrayContaining([old, current]))
    await store.cleanup(at(MINUTE + 26 * HOUR))
    expect(await keyIds()).toEqual([current])
  })
})
