import { describe, expect, test } from 'bun:test'

import { hasNews, markSeen } from '@/lib/board/seen-boards'
import { addDays } from '@/lib/board/time'

// When this device last opened each board (src/lib/board/seen-boards.ts),
// for the „Neu“ marker on the Kita page

describe('the „Neu“ marker', () => {
  const now = new Date('2026-05-04T10:00:00.000Z')
  const at = (days: number) => addDays(now, days).toISOString()

  test('shows when a note is newer than the last visit', () => {
    expect(hasNews(at(-1), at(-2))).toBe(true)
    expect(hasNews(at(-2), at(-1))).toBe(false)
    expect(hasNews(at(-1), at(-1))).toBe(false)
  })

  test('a board never opened here has news once anything hangs there', () => {
    expect(hasNews(at(-1))).toBe(true)
    expect(hasNews(null)).toBe(false)
    expect(hasNews(null, at(-1))).toBe(false)
  })

  test('a visit never moves back in time', () => {
    const seen = markSeen({}, 'a', at(-1), now)
    expect(seen).toEqual({ a: at(-1) })
    expect(markSeen(seen, 'a', at(-2), now)).toEqual({ a: at(-1) })
    expect(markSeen(seen, 'a', at(0), now)).toEqual({ a: at(0) })
  })

  test('forgets visits older than the longest a note hangs', () => {
    const seen = { old: at(-31), recent: at(-29) }
    expect(markSeen(seen, 'a', at(0), now)).toEqual({
      recent: at(-29),
      a: at(0),
    })
  })
})
