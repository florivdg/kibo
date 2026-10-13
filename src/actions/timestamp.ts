import { z } from 'astro/zod'

// A timestamp PostgreSQL can take: an unparsable string would reach it as
// "Invalid Date" and answer 500 instead of 400. So would the year 0 (which
// "0001-01-01T00:00:00+01:00" falls into) in push.sync's seen.until, written
// out as drizzle sends it; the note cursor refuses it too, so both agree.
export const timestamp = z.iso
  .datetime({ offset: true })
  .refine((value) => new Date(value).getUTCFullYear() >= 1)
