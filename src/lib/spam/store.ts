import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { and, desc, gt, inArray, lte, sql } from 'drizzle-orm'

import { spamCounter, spamFingerprint, spamKey } from '@/db/schema'
import type { Database, Executor } from '@/db/types'

import { MAX_WINDOW_MS, SLIDING_LOOKBACK_MS, type Budget } from './budgets'

// Counters live in PostgreSQL, the one piece of infrastructure Kibo already
// has. Every increment is a single atomic statement, so parallel requests and
// several app processes share one budget, and a restart continues where the
// last one left off.
//
// A note and the fingerprint that says "this text is taken" have to be
// written together or not at all, so every statement here can be pointed at
// the caller's transaction (an Executor: the pool or a running transaction).

// The id of the key created the first time the store runs. Fixed, so two
// processes starting at once can't seed two different keys.
const FIRST_KEY_ID = 'initial'
// Re-reading the keys on every request would double the queries; a minute of
// staleness only delays a rotation taking effect.
const KEY_CACHE_MS = 60_000
// A signature under a key id the cache doesn't know may be from a key another
// process created since: the keys are read again for it, but not more often
// than this, so made-up key ids cost the database next to nothing
const KEY_RECHECK_MS = 5_000
// A retired key stays valid while counters written with it can still be live:
// counted from when it was superseded, not from when it was created
const KEY_RETENTION_MS = MAX_WINDOW_MS + 60 * 60_000
// A finished window is still read by the sliding budgets for a while
const COUNTER_GRACE_MS = SLIDING_LOOKBACK_MS + 5 * 60_000

interface SpamKey {
  id: string
  secret: string
  createdAt: Date
}

// What each kind of budget is counted for in this one call
type BudgetSubjects = Partial<Record<Budget['subject'], string>>

interface BudgetVerdict {
  allowed: boolean
  // 0 when allowed; otherwise how long the strictest exceeded window runs
  retryAfterMs: number
}

function digest(secret: string, value: string) {
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(value)
    .digest('base64url')
}

// Counters are kept in fixed windows, because a fixed window is one row that
// can be incremented atomically — a turned-away attempt can never push it
// further out. Budgets marked `sliding` get the smoothing on top when they are
// evaluated, which is what removes the doubling at a window border.
function windowStart(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs
}

export function createSpamStore(db: Database) {
  let cached: SpamKey[] | undefined
  let cachedAt = 0
  // Unknown-key refreshes have their own throttle: a normal cache read must
  // not prevent finding a key another process created three seconds later.
  let recheckedAt: number | undefined
  // The one read through the pool under way, which every caller that finds
  // the cache too old waits for, rather than each starting its own
  let reading: Promise<SpamKey[]> | undefined
  // A read through the pool that failed: for KEY_RECHECK_MS after it, callers
  // get the same error without asking the database again
  let failed: { at: number; error: unknown } | undefined

  const newestFirst = [desc(spamKey.createdAt), desc(spamKey.id)] as const

  // Read through the caller's transaction when there is one, so a note being
  // written doesn't hold a second pool connection just for the keys. Seeding
  // the very first key goes through the pool on purpose: rolled back with the
  // caller's transaction, it would leave this process with a key nobody else
  // has.
  async function readKeys(on: Executor) {
    const rows = await on
      .select()
      .from(spamKey)
      .orderBy(...newestFirst)
    if (rows.length) return rows
    await db
      .insert(spamKey)
      .values({ id: FIRST_KEY_ID, secret: randomBytes(32).toString('base64') })
      .onConflictDoNothing()
    return on
      .select()
      .from(spamKey)
      .orderBy(...newestFirst)
  }

  // A key is retired the moment the next one is created, and only from then on
  // do its counters stop growing. So it is kept until that moment plus the
  // longest window, not until its own creation plus that: an old key rotated
  // out just now still has a full day of live counters. Keys newest first.
  function retiredLongAgo(keys: SpamKey[], index: number, now: Date) {
    const successor = keys[index - 1]
    return (
      successor !== undefined &&
      successor.createdAt.getTime() < now.getTime() - KEY_RETENTION_MS
    )
  }

  // Newest key first; older ones stay in the list until their counters can no
  // longer be live, so rotating a key hands out no extra budget. Read anew
  // once the cache is older than `maxAgeMs`.
  async function keysNoOlderThan(maxAgeMs: number, now: Date, on: Executor) {
    const keys =
      cached && now.getTime() - cachedAt <= maxAgeMs
        ? cached
        : await (on === db ? readShared(now) : readThrough(on, now))
    return keys.filter((_, index, all) => !retiredLongAgo(all, index, now))
  }

  // Through the caller's transaction, which nobody else can share
  async function readThrough(on: Executor, now: Date) {
    const rows = await readKeys(on)
    cached = rows
    cachedAt = now.getTime()
    return rows
  }

  // Through the pool: parallel callers share one read, and a failed one is
  // not repeated for KEY_RECHECK_MS — so a burst of made-up key ids costs one
  // query, and while the database is away, none. Its error still reaches
  // every caller, so verification keeps failing as it did.
  async function readShared(now: Date) {
    const sinceFailure = failed ? now.getTime() - failed.at : -1
    if (failed && sinceFailure >= 0 && sinceFailure < KEY_RECHECK_MS) {
      throw failed.error
    }
    reading ??= readKeys(db)
      .then(
        (rows) => {
          cached = rows
          cachedAt = now.getTime()
          failed = undefined
          return rows
        },
        (error: unknown) => {
          failed = { at: now.getTime(), error }
          throw error
        },
      )
      .finally(() => {
        reading = undefined
      })
    return reading
  }

  function liveKeys(now: Date, on: Executor = db) {
    return keysNoOlderThan(KEY_CACHE_MS, now, on)
  }

  // For a key id the cache doesn't know (see KEY_RECHECK_MS)
  function refreshKeys(now: Date) {
    const sinceRecheck =
      recheckedAt === undefined ? KEY_RECHECK_MS : now.getTime() - recheckedAt
    if (
      !reading &&
      !failed &&
      sinceRecheck >= 0 &&
      sinceRecheck < KEY_RECHECK_MS
    ) {
      return liveKeys(now)
    }
    recheckedAt = now.getTime()
    // A read already completed for this request needs no repeat. Otherwise
    // refresh now, sharing any in-flight read and its failure backoff.
    return keysNoOlderThan(0, now, db)
  }

  interface Counted {
    budget: Budget
    bucket: string
    // Bucket of the window before this one, for sliding budgets
    previous?: string
    expiresAt: Date
    // How much of the previous window still counts, 1 → 0 across this one
    carry: number
  }

  function bucketOf(key: SpamKey, budget: Budget, subject: string, at: number) {
    return digest(key.secret, `${budget.name}|${subject}|${at}`)
  }

  function plan(
    budgets: Budget[],
    subjects: BudgetSubjects,
    now: Date,
    key: SpamKey,
  ) {
    const counted: Counted[] = []
    for (const budget of budgets) {
      const subject = subjects[budget.subject]
      if (subject === undefined) continue
      const start = windowStart(now.getTime(), budget.windowMs)
      const elapsed = now.getTime() - start
      counted.push({
        budget,
        bucket: bucketOf(key, budget, subject, start),
        previous: budget.sliding
          ? bucketOf(key, budget, subject, start - budget.windowMs)
          : undefined,
        expiresAt: new Date(start + budget.windowMs),
        carry: budget.sliding ? 1 - elapsed / budget.windowMs : 0,
      })
    }
    return counted
  }

  // Reads counters this call does not increment: the previous window of the
  // sliding budgets, and everything counted under keys that have since been
  // rotated out.
  async function readCounts(buckets: string[], on: Executor) {
    if (!buckets.length) return new Map<string, number>()
    const rows = await on
      .select({ bucket: spamCounter.bucket, count: spamCounter.count })
      .from(spamCounter)
      .where(inArray(spamCounter.bucket, buckets))
    return new Map(rows.map((row) => [row.bucket, row.count]))
  }

  // How much of the previous window a sliding budget still carries
  function carried(entry: Counted, known: Map<string, number>) {
    if (!entry.previous) return 0
    return (known.get(entry.previous) ?? 0) * entry.carry
  }

  // The one statement that makes this work across processes and in parallel
  async function increment(counted: Counted[], on: Executor) {
    const rows = await on
      .insert(spamCounter)
      .values(
        counted.map(({ bucket, expiresAt }) => ({
          bucket,
          count: 1,
          expiresAt,
        })),
      )
      .onConflictDoUpdate({
        target: spamCounter.bucket,
        set: { count: sql`${spamCounter.count} + 1` },
      })
      .returning({ bucket: spamCounter.bucket, count: spamCounter.count })
    return new Map(rows.map((row) => [row.bucket, row.count]))
  }

  // What each budget already counted under keys that have been rotated out
  function retiredTotals(retired: Counted[], known: Map<string, number>) {
    const totals = new Map<string, number>()
    for (const entry of retired) {
      const spent = (known.get(entry.bucket) ?? 0) + carried(entry, known)
      const name = entry.budget.name
      totals.set(name, (totals.get(name) ?? 0) + spent)
    }
    return totals
  }

  // Counts one attempt against every budget in a single statement and reports
  // whether all of them still have room.
  async function consume(
    budgets: Budget[],
    subjects: BudgetSubjects,
    now: Date,
    on: Executor = db,
  ): Promise<BudgetVerdict> {
    const keys = await liveKeys(now, on)
    const counted = plan(budgets, subjects, now, keys[0]!)
    if (!counted.length) return { allowed: true, retryAfterMs: 0 }
    const retired = keys
      .slice(1)
      .flatMap((key) => plan(budgets, subjects, now, key))

    // The two touch disjoint buckets — this call's windows on one side, the
    // windows before them and the retired keys on the other — so they can run
    // at the same time
    const [counts, known] = await Promise.all([
      increment(counted, on),
      readCounts(
        [
          ...counted.flatMap(({ previous }) => previous ?? []),
          ...retired.flatMap((entry) =>
            [entry.bucket, entry.previous ?? []].flat(),
          ),
        ],
        on,
      ),
    ])
    const fromRetired = retiredTotals(retired, known)

    let retryAfterMs = 0
    for (const entry of counted) {
      const total =
        (counts.get(entry.bucket) ?? 1) +
        carried(entry, known) +
        (fromRetired.get(entry.budget.name) ?? 0)
      if (total <= entry.budget.max) continue
      retryAfterMs = Math.max(
        retryAfterMs,
        entry.expiresAt.getTime() - now.getTime(),
      )
    }
    return { allowed: retryAfterMs === 0, retryAfterMs }
  }

  // Claims a piece of content for the note that was just written. False means
  // the identical content is already claimed and still within its window —
  // including when two requests arrive at the same moment, because the claim
  // is one statement and the primary key decides which of them waits.
  //
  // The claim carries the note's id, so removing that note — by its author, by
  // an admin, or when it expires — frees the text again. Rolling the caller's
  // transaction back undoes both together.
  async function claimContent(
    scope: string,
    content: string,
    noteId: string,
    windowMs: number,
    now: Date,
    on: Executor = db,
  ) {
    const keys = await liveKeys(now, on)
    const value = `${scope}|${content}`

    // Before claiming under the current key: a claim made under a key that has
    // since been rotated out still counts, and claiming first would overwrite
    // nothing but would let the duplicate through
    const older = keys.slice(1)
    if (older.length) {
      const previous = await on
        .select({ fingerprint: spamFingerprint.fingerprint })
        .from(spamFingerprint)
        .where(
          and(
            inArray(
              spamFingerprint.fingerprint,
              older.map((key) => digest(key.secret, value)),
            ),
            gt(spamFingerprint.expiresAt, now),
          ),
        )
      if (previous.length) return false
    }

    const expiresAt = new Date(now.getTime() + windowMs)
    const claimed = await on
      .insert(spamFingerprint)
      .values({
        fingerprint: digest(keys[0]!.secret, value),
        noteId,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: spamFingerprint.fingerprint,
        set: { noteId, expiresAt },
        setWhere: lte(spamFingerprint.expiresAt, now),
      })
      .returning({ fingerprint: spamFingerprint.fingerprint })
    return claimed.length > 0
  }

  // A signature of `value` under the current key, and that key's id, for
  // something the server hands out and wants back unchanged
  // (src/lib/spam/form-token.ts)
  async function sign(value: string, now: Date) {
    const [current] = await liveKeys(now)
    return { keyId: current!.id, signature: digest(current!.secret, value) }
  }

  // Whether `signature` is one of `value` under the key `keyId`, as long as
  // that key is live: a rotated-out key keeps verifying for as long as it
  // keeps counting. Only an id the cached keys don't have reads them again.
  async function verify(
    keyId: string,
    value: string,
    signature: string,
    now: Date,
  ) {
    const withId = (keys: SpamKey[]) => keys.find((key) => key.id === keyId)
    const key = withId(await liveKeys(now)) ?? withId(await refreshKeys(now))
    if (!key) return false
    const given = Buffer.from(signature)
    const expected = Buffer.from(digest(key.secret, value))
    return expected.length === given.length && timingSafeEqual(expected, given)
  }

  // Counters are kept a little past their window, because the sliding budgets
  // look back into it; fingerprints and retired keys go once they are done.
  // Reads the keys afresh rather than from the cache: deleting one that a
  // newer rotation has not yet reached this process would be worse than a
  // query an hour.
  async function cleanup(now: Date) {
    const [keys] = await Promise.all([
      readKeys(db),
      db
        .delete(spamCounter)
        .where(
          lte(
            spamCounter.expiresAt,
            new Date(now.getTime() - COUNTER_GRACE_MS),
          ),
        ),
      db.delete(spamFingerprint).where(lte(spamFingerprint.expiresAt, now)),
    ])
    const done = keys
      .filter((_, index) => retiredLongAgo(keys, index, now))
      .map((key) => key.id)
    if (done.length) await db.delete(spamKey).where(inArray(spamKey.id, done))
  }

  return { consume, claimContent, cleanup, sign, verify }
}
