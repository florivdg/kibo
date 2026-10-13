const DAY = 24 * 60 * 60 * 1000

// Every Kita is in Germany, and the server runs in UTC: days start and end in
// Berlin, so the page reads the same before and after hydration
const TIME_ZONE = 'Europe/Berlin'

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
})

const dayAndMonth = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
})

const dayMonthAndYear = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  dateStyle: 'long',
})

const dayAndClock = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
})

// What the clocks in Berlin show at this moment, read as if it were UTC
function berlinClock(date: Date) {
  const parts: Record<string, number> = {}
  for (const { type, value } of wallClock.formatToParts(date)) {
    parts[type] = Number(value)
  }
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour,
    parts.minute,
  )
}

// The Berlin calendar day as a day count, so subtracting two gives whole days
// regardless of daylight saving time
function dayNumber(date: Date) {
  return Math.floor(berlinClock(date) / DAY)
}

// Every note on the board is measured against the same `now`, several times
// per note: its day number is worked out once
let today = { time: Number.NaN, day: 0 }

function todayNumber(now: Date) {
  const time = now.getTime()
  if (time !== today.time) today = { time, day: dayNumber(now) }
  return today.day
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY)
}

const MINUTE = 60_000

// What Berlin is ahead of UTC at this moment. The clock above reads whole
// minutes, which is all an offset has.
function berlinOffset(time: number) {
  const minute = Math.floor(time / MINUTE) * MINUTE
  return berlinClock(new Date(minute)) - minute
}

// The same time of day in Berlin, `days` calendar days on (or back): a
// deadline that counts days ends at the hour it began, also across the two
// nights the clocks change — where adding 24 hours each would land an hour
// off, and for a deadline at midnight on the wrong day.
export function addBerlinDays(date: Date, days: number): Date {
  const time = date.getTime()
  const offset = berlinOffset(time)
  // The wall clock then, read as if it were UTC …
  const wall = time + offset + days * DAY
  // … moved back by what Berlin is ahead then. Read twice: the first guess
  // uses today's offset and may lie on the other side of a change. A time the
  // clocks skip in March becomes the one an hour later.
  const guess = wall - berlinOffset(wall - offset)
  return new Date(wall - berlinOffset(guess))
}

// Whole calendar days from today until the day of `date`, never below zero
export function daysUntil(date: Date, now: Date): number {
  return Math.max(0, dayNumber(date) - todayNumber(now))
}

// Whole calendar days until the note is taken down
export function daysLeft(expiresAt: string, now: Date): number {
  return daysUntil(new Date(expiresAt), now)
}

export function postedLabel(createdAt: string, now: Date): string {
  const days = todayNumber(now) - dayNumber(new Date(createdAt))
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

export function takenDownLabel(expiresAt: string, now: Date): string {
  const days = daysLeft(expiresAt, now)
  if (days === 0) return 'Wird heute abgenommen'
  if (days === 1) return 'Wird morgen abgenommen'
  return `Wird am ${dayAndMonth.format(new Date(expiresAt))} abgenommen`
}

// The day written out with its year, for dates the admin area names: the
// last day of an invitation
export function longDate(date: Date): string {
  return dayMonthAndYear.format(date)
}

// Day and time of day in Berlin, for when something happened: a report of a
// note, the closing of its case
export function dateAndTime(date: Date): string {
  return dayAndClock.format(date)
}

// The last moment of a period that runs up to `end` without including it. A
// year paid "until 31 December" ends at midnight, which is already 1 January:
// its last day is the one to name and to count the days to.
export function lastMoment(end: Date): Date {
  return new Date(end.getTime() - 1)
}

// The Berlin calendar day of a moment, written as JJJJ-MM-TT
export function berlinDay(date: Date): string {
  return new Date(berlinClock(date)).toISOString().slice(0, 10)
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// The end of a day written as JJJJ-MM-TT: midnight in Berlin, the first
// moment of the day after. Undefined for anything that is no day of the
// calendar — 2026-02-30 would otherwise quietly become the 2nd of March.
export function berlinDayEnd(day: string): Date | undefined {
  const match = CALENDAR_DAY.exec(day)
  if (!match) return undefined
  const start = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  if (new Date(start).toISOString().slice(0, 10) !== day) return undefined
  // Midnight as if Berlin were UTC, moved back by what Berlin is ahead. The
  // clocks change at 01:00 UTC, so the offset read here is midnight's too.
  const midnight = start + DAY
  return new Date(midnight - berlinOffset(midnight))
}
