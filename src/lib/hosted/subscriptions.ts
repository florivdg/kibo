import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  alias,
  type AnyPgColumn,
  type PgUpdateSetSource,
} from 'drizzle-orm/pg-core'

import {
  board,
  hostedSubscription,
  member,
  organization,
  user,
} from '@/db/schema'
import type { Executor } from '@/db/types'
import { addBerlinDays, addDays } from '@/lib/board/time'
import { HOSTED_NOTICE_RETRY_MINUTES, HOSTED_REMINDER_DAYS } from '@/lib/limits'
import { ownsOrganization } from '@/lib/organization-owner'

import type { BillingDetails } from './billing'
import { isPausedState, subscriptionState, type ReminderStage } from './state'

// The subscriptions of the hosted instance, as the database has them. Every
// function names the database it runs on: the app hands in its pool
// (src/lib/hosted/access.ts), scripts/admin.ts its one connection. Nothing
// here may import `@/db` — that loads `astro:env`, which the script doesn't
// have.

export type Subscription = typeof hostedSubscription.$inferSelect

// What the state is computed from (src/lib/hosted/state.ts), for the queries
// that need no more of the row
export const subscriptionDates = {
  trialEndsAt: hostedSubscription.trialEndsAt,
  paidUntil: hostedSubscription.paidUntil,
  complimentary: hostedSubscription.complimentary,
}

// The member row of the owner of a Kita, for the queries that join it
export const kitaOwner = alias(member, 'kita_owner')

export async function findSubscription(on: Executor, userId: string) {
  const [row] = await on
    .select()
    .from(hostedSubscription)
    .where(eq(hostedSubscription.userId, userId))
  return row
}

// A subscription whose trial starts now. It ends at the same time of day in
// Berlin, `trialDays` days of the calendar on — like every other deadline of
// a subscription (src/lib/hosted/state.ts).
function trial(userId: string, now: Date, trialDays: number) {
  return {
    userId,
    trialEndsAt: addBerlinDays(now, trialDays),
    createdAt: now,
    updatedAt: now,
  }
}

// The terms an account agreed to (HOSTED_TERMS_VERSION), and when. No
// address of the network it came from: the account is who agreed.
export interface TermsAcceptance {
  termsVersion: string
  termsAcceptedAt: Date
}

// The account's subscription, created if it has none: the trial starts now.
// This is how an account gets one, with its first Kita (src/lib/auth.ts),
// which is also when it agrees to the terms. Idempotent: asked twice at once,
// there is one row, and a trial that is running is not started over — a row
// that is there only takes the agreement (an account whose Kitas were
// deleted and that paid again creates a first Kita once more).
export async function ensureSubscription(
  on: Executor,
  userId: string,
  now: Date,
  trialDays: number,
  terms?: TermsAcceptance,
) {
  const created = on
    .insert(hostedSubscription)
    .values({ ...trial(userId, now, trialDays), ...terms })
  await (terms
    ? created.onConflictDoUpdate({
        target: hostedSubscription.userId,
        set: { ...terms, updatedAt: now },
      })
    : created.onConflictDoNothing())
}

// The same for every account that owns a Kita and has no subscription: the
// owners from before HOSTED was switched on, and the rare one whose row could
// not be written with the first Kita. Their trial starts now. Returns how
// many were created; run again — or by two processes at once — it finds
// nothing left to do.
export async function backfillSubscriptions(
  on: Executor,
  now: Date,
  trialDays: number,
) {
  const owners = await on
    .selectDistinct({ userId: member.userId })
    .from(member)
    .leftJoin(hostedSubscription, eq(hostedSubscription.userId, member.userId))
    .where(and(ownsOrganization(), isNull(hostedSubscription.userId)))
  if (!owners.length) return 0
  const created = await on
    .insert(hostedSubscription)
    .values(owners.map(({ userId }) => trial(userId, now, trialDays)))
    .onConflictDoNothing()
    .returning({ userId: hostedSubscription.userId })
  return created.length
}

// Who answers for a Kita — its owner — and the dates of their subscription,
// if there is one. Undefined for a Kita without an owner.
export async function ownerSubscriptionOf(
  on: Executor,
  organizationId: string,
) {
  const [row] = await on
    .select({ ownerId: member.userId, subscription: subscriptionDates })
    .from(member)
    .leftJoin(hostedSubscription, eq(hostedSubscription.userId, member.userId))
    .where(and(eq(member.organizationId, organizationId), ownsOrganization()))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return row
}

// What the operator sets on an account's subscription. An account without
// one gets one whose trial is over — what counts from here on is what was
// set. `onInsert` is what only that new row is given: a row that is there
// keeps everything that isn't in `set`, its trial first of all.
async function setOnSubscription(
  on: Executor,
  userId: string,
  now: Date,
  set: Partial<Subscription>,
  onInsert: Partial<Subscription> = {},
): Promise<Subscription> {
  const [row] = await on
    .insert(hostedSubscription)
    .values({
      userId,
      trialEndsAt: now,
      createdAt: now,
      ...onInsert,
      ...set,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: hostedSubscription.userId,
      set: { ...set, updatedAt: now },
    })
    .returning()
  return row!
}

// A new period begins: its reminders start over, and what the last one came
// to — the announcement of a deletion, the deletion itself — is history
const NEW_PERIOD = {
  reminderStage: 0,
  deletionNoticeAt: null,
  kitasDeletedAt: null,
}

// The operator has the money: the account is paid for up to `until`. A
// request for an invoice is answered with that, and the reminders start over.
// A day in the past ends the subscription on that day, so an account that
// gets its row here has no trial reaching beyond it either — the grace period
// counts from `until`, not from now.
export function setPaidUntil(
  on: Executor,
  userId: string,
  until: Date,
  now: Date,
) {
  return setOnSubscription(
    on,
    userId,
    now,
    { paidUntil: until, invoiceRequestedAt: null, ...NEW_PERIOD },
    { trialEndsAt: until < now ? until : now },
  )
}

// Free for good, for the operator's own account and whoever else is not to
// be billed
export function grantComplimentary(on: Executor, userId: string, now: Date) {
  return setOnSubscription(on, userId, now, { complimentary: true })
}

// Takes that back. The account is never dropped straight into a pause, or
// into the deletion that follows one: whatever its dates say, it has a trial
// from now on to sort out the payment. Undefined when the account wasn't
// free in the first place.
export async function revokeComplimentary(
  on: Executor,
  userId: string,
  now: Date,
  trialDays: number,
): Promise<Subscription | undefined> {
  const { trialEndsAt } = trial(userId, now, trialDays)
  const [row] = await on
    .update(hostedSubscription)
    .set({
      complimentary: false,
      trialEndsAt: sql`greatest(${hostedSubscription.trialEndsAt}, ${trialEndsAt})`,
      ...NEW_PERIOD,
      updatedAt: now,
    })
    .where(
      and(
        eq(hostedSubscription.userId, userId),
        eq(hostedSubscription.complimentary, true),
      ),
    )
    .returning()
  return row
}

// The account asks for an invoice: where it goes, and that it was asked for
// now. With `terms` the account agreed to them in the same breath. An owner
// the hourly run has not reached yet gets the row here, with the trial it
// would have started.
export function saveInvoiceRequest(
  on: Executor,
  userId: string,
  request: {
    billing: BillingDetails
    terms?: TermsAcceptance
    trialDays: number
  },
  now: Date,
) {
  return setOnSubscription(
    on,
    userId,
    now,
    { ...request.billing, invoiceRequestedAt: now, ...request.terms },
    trial(userId, now, request.trialDays),
  )
}

// The Kitas an account owns, by name
export function ownedKitas(on: Executor, userId: string) {
  return on
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), ownsOrganization()))
    .orderBy(asc(organization.name), asc(organization.id))
}

// The accounts the hourly run may have something to say to (./reminders.ts),
// with the address the mail goes to: every subscription that is billed, whose
// owner owns a Kita that is still there, and whose trial or paid period is
// over or about to be. What is due is decided by the calendar in Berlin, from
// the row; this is only the loose version of that, a day wider than the
// first reminder reaches, so that the run doesn't read every account every
// hour. `only` narrows it down to these accounts.
export function listReminderCandidates(
  on: Executor,
  now: Date,
  only?: string[],
) {
  const { trialEndsAt, paidUntil } = hostedSubscription
  const ownsKita = on
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, hostedSubscription.userId), ownsOrganization()),
    )
  return on
    .select({
      subscription: hostedSubscription,
      email: user.email,
      name: user.name,
    })
    .from(hostedSubscription)
    .innerJoin(user, eq(user.id, hostedSubscription.userId))
    .where(
      and(
        eq(hostedSubscription.complimentary, false),
        isNull(hostedSubscription.kitasDeletedAt),
        // The later of the two ends; `greatest` skips a paid period that
        // isn't there
        sql`greatest(${trialEndsAt}, ${paidUntil}) < ${addDays(now, HOSTED_REMINDER_DAYS + 1)}`,
        exists(ownsKita),
        only && inArray(hostedSubscription.userId, only),
      ),
    )
    .orderBy(asc(hostedSubscription.userId))
}

// A column holds the moment the run read from it. Postgres keeps
// microseconds and JavaScript read milliseconds, so the column is cut to
// those before the two are compared.
function sameMoment(column: AnyPgColumn, moment: Date) {
  return sql`date_trunc('milliseconds', ${column}) = ${moment}`
}

// The row as the run read it is still the row: nobody paid, freed the account
// or deleted its Kitas in between. What is decided from the dates is only
// written while they stand.
function unchanged(row: Subscription) {
  return and(
    eq(hostedSubscription.userId, row.userId),
    sameMoment(hostedSubscription.trialEndsAt, row.trialEndsAt),
    row.paidUntil
      ? sameMoment(hostedSubscription.paidUntil, row.paidUntil)
      : isNull(hostedSubscription.paidUntil),
    eq(hostedSubscription.complimentary, false),
    isNull(hostedSubscription.kitasDeletedAt),
  )
}

// Nothing holds the deletion at `now`: no hold, or one that has run out
// (holdDeletion)
function notHeld(now: Date) {
  return or(
    isNull(hostedSubscription.deletionHeldUntil),
    lte(hostedSubscription.deletionHeldUntil, now),
  )
}

// What lets a call move the row on to `stage`: the row has not got that far.
// The announcement of the deletion (stage 4) has a second way in — a row that
// is at 4 already while nothing says the mail went out
// (confirmDeletionNotice): the attempt failed, or its process died on the
// way. It is taken up again once it is HOSTED_NOTICE_RETRY_MINUTES old, so a
// mail another process is sending this moment is not taken for one that
// failed, and only by whoever finds the row as it was read: the claim itself
// touches it (updatedAt), so of two processes one wins here as well.
// Undefined when there is nothing to claim.
function stageClaim(row: Subscription, stage: ReminderStage, now: Date) {
  // The announcement waits while the deletion is held — also for a run that
  // read the row before the operator held it
  const held = stage === 4 ? notHeld(now) : undefined
  if (row.reminderStage < stage) {
    return and(lt(hostedSubscription.reminderStage, stage), held)
  }
  const retryFrom =
    row.updatedAt.getTime() + HOSTED_NOTICE_RETRY_MINUTES * 60 * 1000
  if (stage !== 4 || row.deletionNoticeAt || now.getTime() < retryFrom) {
    return undefined
  }
  return and(
    eq(hostedSubscription.reminderStage, 4),
    isNull(hostedSubscription.deletionNoticeAt),
    sameMoment(hostedSubscription.updatedAt, row.updatedAt),
    held,
  )
}

// Moves the account on to a reminder it has not had yet, and says whether
// this call was the one that did: of two processes that run at the same
// moment, one gets true and sends the mail. For stage 4 that is all it
// does — when the deletion was announced is only written once the mail went
// out (confirmDeletionNotice), and until then the stage can be claimed again.
export async function advanceReminderStage(
  on: Executor,
  row: Subscription,
  stage: ReminderStage,
  now: Date,
) {
  const claim = stageClaim(row, stage, now)
  if (!claim) return false
  const advanced = await on
    .update(hostedSubscription)
    .set({ reminderStage: stage, updatedAt: now })
    .where(and(unchanged(row), claim))
    .returning({ userId: hostedSubscription.userId })
  return advanced.length > 0
}

// The announcement of the deletion this run claimed at `claimedAt`
// (advanceReminderStage) is still its own: the row stands as it was read, at
// stage 4 without a notice, nothing holds the deletion, and nobody has
// written to the row since the claim — not the operator holding the deletion
// or releasing it again, not another run claiming the stage afresh
function ownDeletionClaim(row: Subscription, claimedAt: Date) {
  return and(
    unchanged(row),
    eq(hostedSubscription.reminderStage, 4),
    isNull(hostedSubscription.deletionNoticeAt),
    notHeld(claimedAt),
    sameMoment(hostedSubscription.updatedAt, claimedAt),
  )
}

// Whether the announcement claimed at `claimedAt` is still to be sent, asked
// right before the mail goes out: the claim and the mail are not one step,
// and the operator may have held the deletion in between
export async function deletionClaimStands(
  on: Executor,
  row: Subscription,
  claimedAt: Date,
) {
  const found = await on
    .select({ userId: hostedSubscription.userId })
    .from(hostedSubscription)
    .where(ownDeletionClaim(row, claimedAt))
  return found.length > 0
}

// The mail that announces the deletion went out: the row remembers when, and
// the two weeks the Kitas are kept count from there. `now` is the moment the
// run claimed stage 4 with (advanceReminderStage), the one the mail computed
// its day from. Written only for that very claim (ownDeletionClaim) — a mail
// whose claim was overtaken is not the announcement — and says whether it was.
export async function confirmDeletionNotice(
  on: Executor,
  row: Subscription,
  now: Date,
) {
  const confirmed = await on
    .update(hostedSubscription)
    .set({ deletionNoticeAt: now, updatedAt: now })
    .where(ownDeletionClaim(row, now))
    .returning({ userId: hostedSubscription.userId })
  return confirmed.length > 0
}

// Deletes every Kita the account owns and returns them. Their Kita link and
// privacy contact, boards, notes, push subscriptions, report cases with their
// reports and notifications, members and invitations go with them through
// the foreign keys. Kitas the account only helps to manage are not touched.
function deleteOwnedKitas(on: Executor, userId: string) {
  const owned = on
    .select({ id: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), ownsOrganization()))
  return on
    .delete(organization)
    .where(inArray(organization.id, owned))
    .returning({ id: organization.id, name: organization.name })
}

// Deletes the Kitas an account owns, once: the row is marked first, so of two
// processes one deletes. The account and its row stay. Returns how many
// Kitas went, undefined when this call was not the one to delete them.
//
// Nothing goes without the announcement the caller counted the two weeks
// from: a row that has none is not touched, and the mark is only set while
// the row still stands at stage 4 with that very notice — not one that was
// paid for, freed, started over or held (holdDeletion) since it was read.
export async function deleteKitasOf(
  on: Executor,
  row: Subscription,
  now: Date,
) {
  const announced = row.deletionNoticeAt
  if (!announced) return undefined
  return on.transaction(async (tx) => {
    const claimed = await tx
      .update(hostedSubscription)
      .set({ kitasDeletedAt: now, updatedAt: now })
      .where(
        and(
          unchanged(row),
          eq(hostedSubscription.reminderStage, 4),
          sameMoment(hostedSubscription.deletionNoticeAt, announced),
          notHeld(now),
        ),
      )
      .returning({ userId: hostedSubscription.userId })
    if (!claimed.length) return undefined
    const deleted = await deleteOwnedKitas(tx, row.userId)
    return deleted.length
  })
}

// The operator deletes the Kitas an account owns at once (`delete-kitas` in
// scripts/admin.ts): after a request to switch providers or to have the data
// erased, on the last day of the period to fetch the data. Works with or
// without a subscription. The row, if there is one, is locked before the Kitas go — in
// the order deleteKitasOf takes the two, so that an hourly run deleting the
// same Kitas waits instead of deadlocking — and its hold is over. Only an
// expired row (paused or due for deletion) is marked like after the
// automatic deletion: that account gets a Kita again once it pays. During
// the trial or a paid period the account may create Kitas as before (in the
// grace period only after set-paid), and those are reminded of and deleted
// like any other; the
// reminders it already had stay had. The account and its row stay. Returns
// the Kitas that went, by name; none when the account owns none — then
// nothing is written.
export function deleteKitasNow(on: Executor, userId: string, now: Date) {
  return on.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(hostedSubscription)
      .where(eq(hostedSubscription.userId, userId))
      .for('update')
    const deleted = await deleteOwnedKitas(tx, userId)
    if (!deleted.length) return deleted
    deleted.sort((a, b) => a.name.localeCompare(b.name, 'de'))
    if (row) {
      const expired = isPausedState(subscriptionState(row, now).state)
      await updateSubscription(tx, userId, now, {
        deletionHeldUntil: null,
        ...(expired && { kitasDeletedAt: now }),
      })
    }
    return deleted
  })
}

// Writes `set` on the account's row, if it has one and `where` holds, and
// returns the row
async function updateSubscription(
  on: Executor,
  userId: string,
  now: Date,
  set: PgUpdateSetSource<typeof hostedSubscription>,
  where?: SQL,
): Promise<Subscription | undefined> {
  const [row] = await on
    .update(hostedSubscription)
    .set({ ...set, updatedAt: now })
    .where(and(eq(hostedSubscription.userId, userId), where))
    .returning()
  return row
}

// What holding the deletion came to: held, refused because the Kitas are
// gone already (on their own or by delete-kitas — there is nothing left to
// keep for the retrieval period), or no row to hold it on
export type DeletionHold =
  | { outcome: 'held'; subscription: Subscription }
  | { outcome: 'kitasDeleted'; at: Date }
  | { outcome: 'noSubscription' }

// The operator holds the automatic deletion of an account's Kitas until
// `until` (`hold-deletion` in scripts/admin.ts). An announcement that went
// out is taken back: the row goes back to the pause (stage 3 at most) without
// a notice, so once the hold is over a new announcement goes out and the
// deletion comes two weeks after it at the earliest — never on the day an
// old mail named. A row whose Kitas were deleted is left as it is, also when
// the hourly run deleted them while this waited for the row.
export async function holdDeletion(
  on: Executor,
  userId: string,
  until: Date,
  now: Date,
): Promise<DeletionHold> {
  const held = await updateSubscription(
    on,
    userId,
    now,
    {
      deletionHeldUntil: until,
      reminderStage: sql`least(${hostedSubscription.reminderStage}, 3)`,
      deletionNoticeAt: null,
    },
    isNull(hostedSubscription.kitasDeletedAt),
  )
  if (held) return { outcome: 'held', subscription: held }
  const row = await findSubscription(on, userId)
  return row?.kitasDeletedAt
    ? { outcome: 'kitasDeleted', at: row.kitasDeletedAt }
    : { outcome: 'noSubscription' }
}

// Ends the hold at once. Undefined when the account has no row.
export function releaseDeletionHold(on: Executor, userId: string, now: Date) {
  return updateSubscription(on, userId, now, { deletionHeldUntil: null })
}

// Deletes the Kitas nobody owns that were created before `before`, and
// returns their ids. `only` narrows it down to these Kitas.
export async function deleteOwnerlessOrganizations(
  on: Executor,
  before: Date,
  only?: string[],
) {
  const owner = on
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organization.id), ownsOrganization()))
  const deleted = await on
    .delete(organization)
    .where(
      and(
        notExists(owner),
        lt(organization.createdAt, before),
        only && inArray(organization.id, only),
      ),
    )
    .returning({ id: organization.id })
  return deleted.map((row) => row.id)
}

// Every account the hosted instance could bill: the ones that own a Kita,
// and the ones that have a subscription without owning one (yet, or any
// more). Sorted by address.
export function listSubscriptionAccounts(on: Executor) {
  const owned = and(eq(member.userId, user.id), ownsOrganization())
  const ownsKita = exists(
    on.select({ id: member.id }).from(member).where(owned),
  )
  return on
    .select({
      email: user.email,
      ownedKitas: on.$count(member, owned),
      subscription: hostedSubscription,
    })
    .from(user)
    .leftJoin(hostedSubscription, eq(hostedSubscription.userId, user.id))
    .where(or(isNotNull(hostedSubscription.userId), ownsKita))
    .orderBy(asc(user.email))
}

// Every Kita with its owner, how many boards and members it has, and the
// owner's subscription. Sorted by name.
export function listKitasWithOwner(on: Executor) {
  return on
    .select({
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      ownerEmail: user.email,
      boards: on.$count(board, eq(board.organizationId, organization.id)),
      members: on.$count(member, eq(member.organizationId, organization.id)),
      subscription: hostedSubscription,
    })
    .from(organization)
    .leftJoin(
      kitaOwner,
      and(
        eq(kitaOwner.organizationId, organization.id),
        ownsOrganization(kitaOwner),
      ),
    )
    .leftJoin(user, eq(user.id, kitaOwner.userId))
    .leftJoin(
      hostedSubscription,
      eq(hostedSubscription.userId, kitaOwner.userId),
    )
    .orderBy(asc(organization.name), asc(organization.id))
}
