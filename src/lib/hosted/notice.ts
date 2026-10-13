import { daysUntil, lastMoment, longDate } from '@/lib/board/time'

import type { KitaOwnerSubscription } from './access'
import { expiryDays, subscriptionState, type EndedPeriod } from './state'

// What the admin area says about the subscription a Kita runs on
// (src/components/admin/HostedNotice.astro). Dates are written out.
export type SubscriptionNotice = {
  // Owners read what to do; the admins they invited, who does it
  isOwner: boolean
} & (
  | {
      state: 'trial'
      // The last day of the trial, and the whole days left until then
      lastDay: string
      daysLeft: number
    }
  | {
      state: 'grace'
      // What ran out: the trial, or a subscription that was paid for
      ended: EndedPeriod
      // The last day that was covered, and the day the boards are paused
      lastDay: string
      pausesOn: string
    }
  | { state: 'paused' }
)

// From what the middleware found out about the active Kita
// (kitaOwnerSubscription in ./access.ts). Null when there is nothing to say:
// the instance isn't hosted, the Kita has no owner or the owner no
// subscription yet, or the subscription is active.
export function subscriptionNotice(
  found: KitaOwnerSubscription | undefined,
  userId: string,
  now = new Date(),
): SubscriptionNotice | null {
  if (!found?.subscription) return null
  const isOwner = found.ownerId === userId
  const status = subscriptionState(found.subscription, now)
  if (status.state === 'active') return null
  if (status.state === 'trial') {
    const last = lastMoment(status.until)
    return {
      state: 'trial',
      isOwner,
      lastDay: longDate(last),
      daysLeft: daysUntil(last, now),
    }
  }
  if (status.state === 'grace') {
    return { state: 'grace', isOwner, ...expiryDays(status) }
  }
  // Due for deletion reads like paused here; what comes of it is told by mail
  return { state: 'paused', isOwner }
}
