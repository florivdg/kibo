import { eq } from 'drizzle-orm'

import { user } from '@/db/schema'
import type { Database } from '@/db/types'
import { berlinDayEnd, lastMoment, longDate } from '@/lib/board/time'
import { normalizeEmail } from '@/lib/email'
import type { HostedPricing } from '@/lib/hosted/pricing'
import {
  deletionHeldThrough,
  subscriptionState,
  type SubscriptionState,
} from '@/lib/hosted/state'
import type { Subscription } from '@/lib/hosted/subscriptions'

import {
  hostedPricingProblems,
  parseHostedPricing,
} from '../instance-config.mjs'
import { CommandError, formatTable, type Env, type Io } from './command'

// What the commands for the hosted instance share: subscriptions, kitas,
// set-paid, set-free, hold-deletion and delete-kitas. They work on any
// instance — without HOSTED there is simply nothing in the table.

// HOSTED_PRICE_EUR and the others, read from the environment the app runs
// with (`docker compose exec app …` has it)
export function pricingFrom(env: Env): HostedPricing {
  const pricing = parseHostedPricing(env)
  if (!pricing) throw new CommandError(hostedPricingProblems(env).join('; '))
  return pricing
}

// The account behind an address, which Better Auth keeps in lower case
export async function accountByEmail(db: Database, address: string) {
  const email = normalizeEmail(address)
  const [found] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, email))
  if (!found) throw new CommandError(`Kein Konto mit der Adresse ${email}`)
  return found
}

// The day given as --until, up to and including which something holds
// (set-paid, hold-deletion), as the moment the day after begins in Berlin
export function untilDay(day: string) {
  const until = berlinDayEnd(day.trim())
  if (!until) {
    throw new CommandError(
      `--until muss ein Datum der Form JJJJ-MM-TT sein: "${day.trim()}"`,
    )
  }
  return until
}

const STATE_LABELS: Record<SubscriptionState, string> = {
  trial: 'Test',
  active: 'aktiv',
  grace: 'Kulanz',
  paused: 'pausiert',
  deletable: 'löschfällig',
}

export const NONE = '–'

// An account that owns Kitas but has no subscription yet: the app gives it
// one when it starts with HOSTED=true, and on its hourly run after that
const NO_SUBSCRIPTION = 'ohne Eintrag'

// What the tables and the JSON say about one subscription. The dates name
// the last day that is covered, the way set-paid takes them.
export function describeSubscription(
  subscription: Subscription | null,
  now: Date,
) {
  if (!subscription) {
    return {
      state: null,
      label: NO_SUBSCRIPTION,
      trialEnds: NONE,
      paidUntil: NONE,
    }
  }
  const { state } = subscriptionState(subscription, now)
  const { complimentary, trialEndsAt, paidUntil } = subscription
  const paid = paidUntil ? longDate(lastMoment(paidUntil)) : NONE
  const label = complimentary ? 'kostenfrei' : STATE_LABELS[state]
  // A request to switch providers or to have the data erased is pending
  const heldThrough = deletionHeldThrough(subscription, now)
  const held = heldThrough
    ? `, Löschung angehalten bis ${longDate(heldThrough)}`
    : ''
  return {
    state,
    label: `${label}${held}`,
    trialEnds: longDate(lastMoment(trialEndsAt)),
    paidUntil: complimentary ? 'unbefristet' : paid,
  }
}

// The flag both lists take
export const JSON_FLAG = {
  json: { help: 'Ausgabe als JSON statt als Tabelle' },
}

// A list the way both commands print it: as JSON, as a table, or as the one
// line that says there is nothing to list
export function writeList<Row>(
  { stdout }: Io,
  asJson: boolean | undefined,
  list: {
    rows: Row[]
    json: (row: Row) => unknown
    empty: string
    headings: string[]
    cells: (row: Row) => (string | number)[]
  },
) {
  const { rows } = list
  if (asJson) {
    stdout.write(`${JSON.stringify(rows.map(list.json), null, 2)}\n`)
  } else if (!rows.length) {
    stdout.write(`[admin] ${list.empty}\n`)
  } else {
    stdout.write(formatTable(list.headings, rows.map(list.cells)))
  }
}
