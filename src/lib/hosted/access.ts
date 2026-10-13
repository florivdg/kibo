import { and, asc, eq, sql, type SQL } from 'drizzle-orm'
import type { SelectedFields } from 'drizzle-orm/pg-core'

import { db } from '@/db'
import { board, hostedSubscription, kitaLink } from '@/db/schema'
import type { Executor } from '@/db/types'
import { errorMessage } from '@/lib/error-message'
import { SUBSCRIPTION_PATH } from '@/lib/auth-paths'
import { hostedContact, hostedPricing, instanceMode } from '@/lib/instance'
import { countOwnedOrganizations } from '@/lib/organization-access'
import { ownsOrganization } from '@/lib/organization-owner'

import { kitaCreationVerdict } from './kita-limit'
import {
  isPausedState,
  subscriptionState,
  type SubscriptionDates,
} from './state'
import {
  backfillSubscriptions,
  findSubscription,
  kitaOwner,
  ownedKitas,
  ownerSubscriptionOf,
  subscriptionDates,
  type Subscription,
  type TermsAcceptance,
} from './subscriptions'

// What the hosted instance (HOSTED=true) lets a Kita do. The one place that
// walks from a Kita to its owner to the owner's subscription; everyone who
// has to know — the board actions, the public note and push actions, the
// push dispatcher, the Kita and board pages and the manifest, the admin
// pages — asks here.
//
// Asking never writes. A subscription is created with the account's first
// Kita (src/lib/auth.ts) and by startMissingSubscriptions below, nowhere
// else; a Kita whose owner has none yet has full access, like one nobody
// owns.
//
// Without HOSTED none of this touches the database, and every Kita has full
// access.

// The owner of a Kita and the dates of their subscription (null for an owner
// who has none yet). Undefined for a Kita without an owner, and without
// HOSTED. The middleware asks once per admin page and leaves the answer in
// `locals` for the notice of the layout and the subscription page.
export async function kitaOwnerSubscription(organizationId: string) {
  if (!instanceMode.hosted) return undefined
  return ownerSubscriptionOf(db, organizationId)
}

export type KitaOwnerSubscription = NonNullable<
  Awaited<ReturnType<typeof kitaOwnerSubscription>>
>

// True once the owner's trial or paid period ended more than the grace
// period ago. A database that doesn't answer fails the caller like any other
// query — a Kita is not waved through because its subscription can't be
// read.
export async function isKitaPaused(organizationId: string, now = new Date()) {
  const found = await kitaOwnerSubscription(organizationId)
  return isPausedOn(found?.subscription ?? null, now)
}

// For whoever reads a board or a Kita link anyway — the Kita and board
// pages, the public actions, the push dispatcher: the chosen columns of the
// one row of `from` (board or kita_link) that `where` finds and, in the same
// statement instead of a second round trip, the subscription of its Kita's
// owner (null without one). The query comes back unfinished, so a caller can
// join more or lock the row.
//
// Without HOSTED the owner's join condition is `false`: Postgres then reads
// neither table, and there is never a subscription to look at. The order is
// the one of ownerSubscriptionOf: whoever owned the Kita first answers for it.
export function withSubscription<T extends SelectedFields>(
  from: typeof board | typeof kitaLink,
  columns: T,
  where: SQL | undefined,
  on: Executor = db,
) {
  const ownsKita = instanceMode.hosted
    ? and(
        eq(kitaOwner.organizationId, from.organizationId),
        ownsOrganization(kitaOwner),
      )
    : sql`false`
  return on
    .select({ ...columns, subscription: subscriptionDates })
    .from(from)
    .leftJoin(kitaOwner, ownsKita)
    .leftJoin(
      hostedSubscription,
      eq(hostedSubscription.userId, kitaOwner.userId),
    )
    .where(where)
    .orderBy(asc(kitaOwner.createdAt))
    .limit(1)
}

// Whether the subscription that came along means the Kita is paused at `now`
export function isPausedOn(subscription: SubscriptionDates | null, now: Date) {
  return (
    subscription !== null &&
    isPausedState(subscriptionState(subscription, now).state)
  )
}

// What creating a Kita takes on the hosted instance, from one look at the
// account — the form and the request that creates it ask the same
// (src/pages/admin/organizations/new.astro, src/lib/auth.ts). `refusal`: why
// the account may not have another one, as a code, or undefined
// (./kita-limit.ts); an account without a subscription is held to what a
// trial allows. `termsRequired`: before its first Kita an account agrees to
// the terms.
export async function hostedKitaCreation(userId: string, now: Date) {
  const [owned, row] = await Promise.all([
    countOwnedOrganizations(userId),
    findSubscription(db, userId),
  ])
  return {
    refusal: kitaCreationVerdict({
      state: row && subscriptionState(row, now).state,
      owned,
    }),
    termsRequired: owned === 0,
  }
}

// What the form for a new Kita does with that. `redirect`: where it sends an
// account that can't have one because its subscription ran out — grace
// period, pause and deleted Kitas alike: the subscription page says what to
// do. Everyone else gets the form, with the box for the terms where they are
// required. Without HOSTED there is neither.
export async function kitaCreationForm(
  userId: string,
  now = new Date(),
): Promise<{ redirect?: string; termsRequired: boolean }> {
  if (!instanceMode.hosted) return { termsRequired: false }
  const { refusal, termsRequired } = await hostedKitaCreation(userId, now)
  const inactive = refusal === 'HOSTED_SUBSCRIPTION_INACTIVE'
  return { redirect: inactive ? SUBSCRIPTION_PATH : undefined, termsRequired }
}

// Whether `version` is the one of the terms that apply now
// (HOSTED_TERMS_VERSION): what an account agreed to, or what the form it
// agrees with showed
export function isCurrentTermsVersion(version: unknown) {
  return version === hostedContact.termsVersion
}

// Whether the account still has to agree to the terms that apply now: its
// row came about without that, or the terms have changed since. The invoice
// request is where that is made up for.
export function termsOutstanding(subscription: Subscription | undefined) {
  return !isCurrentTermsVersion(subscription?.termsVersion)
}

// What is stored when an account agrees to them at `now`
export function currentTerms(now: Date): TermsAcceptance {
  return { termsVersion: hostedContact.termsVersion, termsAcceptedAt: now }
}

// The account as the one a subscription is billed to: its row, if it has
// one, and the Kitas it owns. Undefined for an account that has neither — an
// admin somebody invited, or an account without a Kita yet. This is who may
// ask for an invoice (src/actions/subscription.ts), and who the subscription
// page shows billing details to.
export async function billingAccount(userId: string) {
  const [subscription, kitas] = await Promise.all([
    findSubscription(db, userId),
    ownedKitas(db, userId),
  ])
  return subscription || kitas.length ? { subscription, kitas } : undefined
}

// A subscription for every account that owns a Kita and has none, its trial
// starting now: how the Kitas that were there before HOSTED was switched on
// come to theirs. Called when the server starts and on its hourly timer
// (src/lib/server/runtime.ts), which logs and carries on like the rest of
// that run. Nothing happens without HOSTED.
export async function startMissingSubscriptions(now: Date, on: Executor = db) {
  if (!instanceMode.hosted) return
  try {
    const created = await backfillSubscriptions(
      on,
      now,
      hostedPricing.trialDays,
    )
    if (created) {
      console.info(
        `[hosted] Abo-Einträge für ${created} Konten mit Kita angelegt, die Testphase beginnt jetzt`,
      )
    }
  } catch (error) {
    console.error(
      `[hosted] Anlegen fehlender Abo-Einträge fehlgeschlagen: ${errorMessage(error)}`,
    )
  }
}
