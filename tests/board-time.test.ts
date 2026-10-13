import { describe, expect, test } from 'bun:test'

import {
  addBerlinDays,
  berlinDay,
  berlinDayEnd,
  daysLeft,
  daysUntil,
  lastMoment,
  longDate,
  postedLabel,
  takenDownLabel,
} from '@/lib/board/time'

// Day boundaries are Berlin's, whatever time zone the process runs in: the
// server renders in UTC, the browser in the visitor's zone.
describe('postedLabel', () => {
  test('a note from 23:00 is from yesterday at 00:30 in Berlin', () => {
    // 2026-06-15 23:00 and 2026-06-16 00:30 in Berlin (UTC+2); still the
    // same day in UTC
    expect(
      postedLabel('2026-06-15T21:00:00Z', new Date('2026-06-15T22:30:00Z')),
    ).toBe('gestern')
  })

  test('same Berlin day is today', () => {
    expect(
      postedLabel('2026-01-10T23:30:00Z', new Date('2026-01-11T12:00:00Z')),
    ).toBe('heute')
  })

  test('counts whole days across the switch to summer time', () => {
    // 2026-03-29 is the last Sunday in March
    expect(
      postedLabel('2026-03-27T12:00:00Z', new Date('2026-03-30T08:00:00Z')),
    ).toBe('vor 3 Tagen')
  })

  test('a clock running slightly behind still says today', () => {
    expect(
      postedLabel('2026-06-15T10:00:05Z', new Date('2026-06-15T10:00:00Z')),
    ).toBe('heute')
  })
})

describe('daysLeft', () => {
  test('counts Berlin days, not UTC days', () => {
    // Expires 2026-06-18 00:30 in Berlin, it is 2026-06-15 23:30 there
    expect(
      daysLeft('2026-06-17T22:30:00Z', new Date('2026-06-15T21:30:00Z')),
    ).toBe(3)
  })

  test('counts whole days across the switch to winter time', () => {
    // 2026-10-25 is the last Sunday in October
    expect(
      daysLeft('2026-10-27T10:00:00Z', new Date('2026-10-24T10:00:00Z')),
    ).toBe(3)
  })

  test('never goes below zero', () => {
    expect(
      daysLeft('2026-06-10T10:00:00Z', new Date('2026-06-15T10:00:00Z')),
    ).toBe(0)
  })
})

describe('takenDownLabel', () => {
  test('today and tomorrow in words', () => {
    const now = new Date('2026-06-15T20:00:00Z')
    expect(takenDownLabel('2026-06-15T21:30:00Z', now)).toBe(
      'Wird heute abgenommen',
    )
    // 00:30 on the 16th in Berlin, while it is 22:00 on the 15th there
    expect(takenDownLabel('2026-06-15T22:30:00Z', now)).toBe(
      'Wird morgen abgenommen',
    )
  })

  test('formats the date in Berlin', () => {
    // 2026-07-01 00:30 in Berlin, still June 30 in UTC
    expect(
      takenDownLabel('2026-06-30T22:30:00Z', new Date('2026-06-20T10:00:00Z')),
    ).toBe('Wird am 1. Juli abgenommen')
  })
})

describe('longDate', () => {
  test('writes the Berlin day out with its year', () => {
    // 2027-01-01 00:30 in Berlin, still 2026 in UTC
    expect(longDate(new Date('2026-12-31T23:30:00Z'))).toBe('1. Januar 2027')
  })
})

describe('daysUntil', () => {
  test('counts Berlin days to a date, never below zero', () => {
    const now = new Date('2026-06-15T21:30:00Z')
    // 2026-06-18 00:30 in Berlin, while it is 23:30 on the 15th there
    expect(daysUntil(new Date('2026-06-17T22:30:00Z'), now)).toBe(3)
    expect(daysUntil(now, now)).toBe(0)
    expect(daysUntil(new Date('2026-06-01T10:00:00Z'), now)).toBe(0)
  })
})

describe('berlinDayEnd', () => {
  const end = (day: string) => berlinDayEnd(day)?.toISOString()

  test('is midnight in Berlin, the first moment of the day after', () => {
    // Winter: UTC+1. Summer: UTC+2.
    expect(end('2026-12-31')).toBe('2026-12-31T23:00:00.000Z')
    expect(end('2026-06-30')).toBe('2026-06-30T22:00:00.000Z')
    // The 29th of a leap year's February
    expect(end('2028-02-29')).toBe('2028-02-29T23:00:00.000Z')
  })

  test('holds on the days the clocks change', () => {
    // 2026-03-29, the last Sunday in March, begins in winter time and ends
    // in summer time
    expect(end('2026-03-28')).toBe('2026-03-28T23:00:00.000Z')
    expect(end('2026-03-29')).toBe('2026-03-29T22:00:00.000Z')
    // 2026-10-25, the last Sunday in October, the other way round
    expect(end('2026-10-24')).toBe('2026-10-24T22:00:00.000Z')
    expect(end('2026-10-25')).toBe('2026-10-25T23:00:00.000Z')
  })

  test('the day it was given is the last one covered', () => {
    for (const day of ['2026-03-29', '2026-10-25', '2026-12-31']) {
      const until = berlinDayEnd(day)!
      const [year, month, date] = day.split('-').map(Number)
      const written = new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year!, month! - 1, date)))
      expect(longDate(lastMoment(until))).toBe(written)
      expect(longDate(until)).not.toBe(written)
    }
  })

  test('refuses what is no day of the calendar', () => {
    for (const day of [
      '',
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-1-1',
      '31.12.2026',
      '2026-12-31T00:00:00Z',
      ' 2026-12-31',
      'morgen',
    ]) {
      expect(berlinDayEnd(day)).toBeUndefined()
    }
  })
})

describe('addBerlinDays', () => {
  const plus = (date: string, days: number) =>
    addBerlinDays(new Date(date), days).toISOString()

  test('is 24 hours a day while the clocks stay as they are', () => {
    expect(plus('2026-05-04T10:00:00.000Z', 14)).toBe(
      '2026-05-18T10:00:00.000Z',
    )
    expect(plus('2026-05-18T10:00:00.000Z', -14)).toBe(
      '2026-05-04T10:00:00.000Z',
    )
    expect(plus('2026-05-04T10:00:00.000Z', 0)).toBe('2026-05-04T10:00:00.000Z')
  })

  // Midnight on 18 October is 22:00 UTC, midnight on 1 November 23:00 UTC:
  // 14 times 24 hours would end at 23:00 on 31 October
  test('keeps midnight at midnight across the switch to winter time', () => {
    expect(plus('2026-10-17T22:00:00.000Z', 14)).toBe(
      '2026-10-31T23:00:00.000Z',
    )
    expect(berlinDayEnd('2026-10-31')!.toISOString()).toBe(
      '2026-10-31T23:00:00.000Z',
    )
    // … and a deadline 90 days after 1 September
    expect(plus('2026-08-31T22:00:00.000Z', 90)).toBe(
      '2026-11-29T23:00:00.000Z',
    )
  })

  test('keeps midnight at midnight across the switch to summer time', () => {
    expect(plus('2026-03-21T23:00:00.000Z', 14)).toBe(
      '2026-04-04T22:00:00.000Z',
    )
    expect(plus('2026-04-04T22:00:00.000Z', -14)).toBe(
      '2026-03-21T23:00:00.000Z',
    )
  })

  test('keeps the time of day, down to the millisecond', () => {
    // 12:34:56.789 in Berlin, before and after the clocks went back
    expect(plus('2026-10-20T10:34:56.789Z', 7)).toBe('2026-10-27T11:34:56.789Z')
    expect(plus('2026-10-27T11:34:56.789Z', -7)).toBe(
      '2026-10-20T10:34:56.789Z',
    )
  })

  // 02:30 on 29 March 2026 is not on any clock in Berlin
  test('a time the clocks skip becomes the one an hour later', () => {
    // 02:30 on 28 March, a day on: 03:30 summer time
    expect(plus('2026-03-28T01:30:00.000Z', 1)).toBe('2026-03-29T01:30:00.000Z')
  })

  test('adding days names the day that many later', () => {
    for (const start of [
      '2026-03-20T12:00:00.000Z',
      '2026-10-20T21:59:59.999Z',
      '2026-10-20T22:00:00.000Z',
      '2026-12-31T23:30:00.000Z',
    ]) {
      const from = new Date(start)
      for (const days of [1, 7, 14, 90, 365]) {
        expect(daysUntil(addBerlinDays(from, days), from)).toBe(days)
      }
    }
  })
})

describe('berlinDay', () => {
  test('writes the Berlin day of a moment as JJJJ-MM-TT', () => {
    expect(berlinDay(new Date('2026-06-15T21:59:59.999Z'))).toBe('2026-06-15')
    expect(berlinDay(new Date('2026-06-15T22:00:00.000Z'))).toBe('2026-06-16')
    expect(berlinDay(new Date('2026-12-31T23:00:00.000Z'))).toBe('2027-01-01')
  })

  test('is the day berlinDayEnd ends', () => {
    for (const day of ['2026-03-29', '2026-10-25', '2028-02-29']) {
      const end = berlinDayEnd(day)!
      expect(berlinDay(lastMoment(end))).toBe(day)
      expect(berlinDay(end)).not.toBe(day)
    }
  })
})
