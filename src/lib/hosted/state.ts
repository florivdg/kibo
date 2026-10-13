import { addBerlinDays, lastMoment, longDate } from '@/lib/board/time'
import {
  HOSTED_DELETION_DAYS,
  HOSTED_DELETION_NOTICE_DAYS,
  HOSTED_GRACE_DAYS,
  HOSTED_REMINDER_DAYS,
} from '@/lib/limits'

// Where a subscription of the hosted instance stands. Never stored: it
// follows from the dates of the row and the clock, so nothing has to run for
// a trial to end or a Kita to be paused.
//
// - trial:     until the trial ends
// - active:    paid for, or free for good
// - grace:     the trial or the paid period is over; for HOSTED_GRACE_DAYS
//              everything keeps working and the admin area says what is
//              about to happen
// - paused:    after that: boards are closed to visitors, and all their
//              admins can still do is read them and take notes down
// - deletable: HOSTED_DELETION_DAYS after the end, the account's Kitas are
//              due to go
//
// Nothing here imports server code: the rules are the same in the app, in
// scripts/admin.ts and in the tests.
export type SubscriptionState =
  'trial' | 'active' | 'grace' | 'paused' | 'deletable'

// What the state is computed from (a row of hosted_subscription)
export interface SubscriptionDates {
  trialEndsAt: Date
  paidUntil: Date | null
  complimentary: boolean
}

// Which of the two ran out: the trial, or a paid year
export type EndedPeriod = 'trial' | 'subscription'

// Which of them ended and when, and the two moments that follow from it
export interface ExpiryBounds {
  ended: EndedPeriod
  expiredAt: Date
  pausesAt: Date
  deletableAt: Date
}

export type SubscriptionStatus =
  // The first moment the trial no longer holds
  | { state: 'trial'; until: Date }
  // The same for the paid period; missing for an account that is free for
  // good
  | { state: 'active'; until?: Date }
  | ({ state: 'grace' | 'paused' | 'deletable' } & ExpiryBounds)

// When what the account has runs out — the later of the trial and the paid
// period — and which of the two that is. An account whose paid period ends
// with its trial (set-paid with a day in the past) has had a subscription.
export function coverageEnd({
  trialEndsAt,
  paidUntil,
}: Pick<SubscriptionDates, 'trialEndsAt' | 'paidUntil'>): {
  at: Date
  of: EndedPeriod
} {
  return paidUntil && paidUntil >= trialEndsAt
    ? { at: paidUntil, of: 'subscription' }
    : { at: trialEndsAt, of: 'trial' }
}

// The end and the moments that follow from it: when the Kitas are paused and
// when they are due to go. Both count calendar days in Berlin, not hours: a
// year paid up to midnight is paused at midnight, whatever the clocks did in
// between.
export function expiryBounds(
  dates: Pick<SubscriptionDates, 'trialEndsAt' | 'paidUntil'>,
): ExpiryBounds {
  const { at: expiredAt, of: ended } = coverageEnd(dates)
  return {
    ended,
    expiredAt,
    pausesAt: addBerlinDays(expiredAt, HOSTED_GRACE_DAYS),
    deletableAt: addBerlinDays(expiredAt, HOSTED_DELETION_DAYS),
  }
}

// The same written out, as everyone who tells an account about the end names
// it — the notice in the admin area, the subscription page and the mails:
// which period ended, the last day it covered, and the day the boards are
// paused
export function expiryDays({ ended, expiredAt, pausesAt }: ExpiryBounds) {
  return {
    ended,
    lastDay: longDate(lastMoment(expiredAt)),
    pausesOn: longDate(pausesAt),
  }
}

// Every bound is exclusive: "until" is the first moment that is no longer
// covered. A paid period beats the trial — paying during the trial doesn't
// cut it short, and the later of the two ends is what the grace period and
// the deletion count from.
export function subscriptionState(
  dates: SubscriptionDates,
  now: Date,
): SubscriptionStatus {
  const { trialEndsAt, paidUntil, complimentary } = dates
  if (complimentary) return { state: 'active' }
  if (paidUntil && now < paidUntil) return { state: 'active', until: paidUntil }
  if (now < trialEndsAt) return { state: 'trial', until: trialEndsAt }

  const bounds = expiryBounds(dates)
  if (now < bounds.pausesAt) return { state: 'grace', ...bounds }
  if (now < bounds.deletableAt) return { state: 'paused', ...bounds }
  return { state: 'deletable', ...bounds }
}

// The mails that remind an account of the end of its period, in the order
// they go out (src/lib/hosted/reminders.ts): a week before the end, at the
// end, when the Kitas are paused, and two weeks before they are deleted. The
// row counts how far it got (reminder_stage, 0 before the first).
export type ReminderStage = 1 | 2 | 3 | 4

// The reminder that is due at `now`, 0 for none. Only ever the latest one: a
// server that was down over the end of a trial doesn't send "a week left"
// afterwards. The announcement of the deletion is the exception that is
// never skipped — it is due from two weeks before the deadline for as long
// as the account stays expired, because nothing is deleted without it.
export function dueReminderStage(
  status: SubscriptionStatus,
  dates: Pick<SubscriptionDates, 'trialEndsAt' | 'paidUntil'>,
  now: Date,
): ReminderStage | 0 {
  if (status.state === 'trial' || status.state === 'active') {
    // Free for good: there is no end to remind of
    if (!status.until) return 0
    // A paid period that ends before the trial is not the end yet
    const end = coverageEnd(dates).at
    return now >= addBerlinDays(end, -HOSTED_REMINDER_DAYS) ? 1 : 0
  }
  if (status.state === 'grace') return 2
  const announceAt = addBerlinDays(
    status.deletableAt,
    -HOSTED_DELETION_NOTICE_DAYS,
  )
  return now >= announceAt ? 4 : 3
}

// When the Kitas of an expired account go: at the deadline, and never
// earlier than HOSTED_DELETION_NOTICE_DAYS after the mail that announced it
// went out at `announcedAt` — an account whose deadline had long passed when
// HOSTED was switched on gets its two weeks all the same.
export function deletionDueAt(deletableAt: Date, announcedAt: Date): Date {
  const earliest = addBerlinDays(announcedAt, HOSTED_DELETION_NOTICE_DAYS)
  return earliest > deletableAt ? earliest : deletableAt
}

// The last day the operator holds the deletion of the account's Kitas
// (deletion_held_until, `hold-deletion` in scripts/admin.ts) while the hold
// stands at `now`; null without one or once it is over
export function deletionHeldThrough(
  { deletionHeldUntil }: { deletionHeldUntil?: Date | null },
  now: Date,
): Date | null {
  return deletionHeldUntil && now < deletionHeldUntil
    ? lastMoment(deletionHeldUntil)
    : null
}

// Whether a Kita is paused on its owner's subscription: from the end of the
// grace period on, due for deletion included (src/lib/hosted/access.ts says
// where that is asked)
export function isPausedState(state: SubscriptionState): boolean {
  return state === 'paused' || state === 'deletable'
}
