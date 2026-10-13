import { z } from 'astro/zod'

import { timestamp } from '@/actions/timestamp'

// Where the previous page of notes ended; shared by the public and the admin
// listing so both page the same way.
export const noteCursor = z
  .object({
    createdAt: timestamp,
    id: z.string().max(64),
  })
  .optional()
