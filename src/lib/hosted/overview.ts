import { lastMoment, longDate } from '@/lib/board/time'

import { BOARDS_PAUSED, ENDED_PERIOD, EXPORT_UNTIL_DELETION } from './messages'
import {
  deletionDueAt,
  deletionHeldThrough,
  expiryDays,
  subscriptionState,
  type SubscriptionDates,
  type SubscriptionState,
} from './state'

// What the subscription page says about where a subscription stands
// (src/pages/admin/abo.astro), to the owner and to the admins they invited.
// Dates are written out. No server code in here.

// What the summary is made from: the dates of the row, and — for the owner,
// who is the only one the row is read for in full — when the deletion was
// announced, until when the operator holds it, and when it happened
export type SummarisedSubscription = SubscriptionDates & {
  deletionNoticeAt?: Date | null
  deletionHeldUntil?: Date | null
  kitasDeletedAt?: Date | null
}

// When the Kitas go, as the summary says it: on the day that is set once the
// deletion was announced, before that the earliest one possible
function deletionDay(
  { deletionNoticeAt }: SummarisedSubscription,
  deletableAt: Date,
  now: Date,
) {
  if (deletionNoticeAt) {
    return `am ${longDate(deletionDueAt(deletableAt, deletionNoticeAt))}`
  }
  return `frühestens am ${longDate(deletionDueAt(deletableAt, now))}`
}

// What a paused subscription says about the deletion. While the operator
// holds it, after a request to switch providers or to have the data erased,
// no day is computed: the operator deletes on the last held day, and only a
// new announcement after the hold would name another one.
function deletionDetail(
  subscription: SummarisedSubscription,
  deletableAt: Date,
  now: Date,
) {
  const heldThrough = deletionHeldThrough(subscription, now)
  if (heldThrough) {
    return `Sie haben einen Wechsel des Anbieters oder die Löschung der Daten verlangt. Bis einschließlich ${longDate(heldThrough)} wird deshalb nichts automatisch gelöscht; bis dahin lassen sich die Daten unter „Kita-Einstellungen“ exportieren.`
  }
  const deletesOn = deletionDay(subscription, deletableAt, now)
  return `Ohne Abo werden die Kitas ${deletesOn} gelöscht. ${EXPORT_UNTIL_DELETION}`
}

export interface StatusSummary {
  // `pending`: the owner has no row yet. `free`: never billed. `deleted`:
  // the Kitas are gone and nothing was paid since.
  state: SubscriptionState | 'pending' | 'free' | 'deleted'
  title: string
  detail: string
}

const NEXT_YEAR =
  'Das Abo verlängert sich nicht automatisch. Für das nächste Jahr fordern Sie rechtzeitig eine neue Rechnung an.'

// What an expired subscription says, in the three states that follow its end
function expiredSummary(
  subscription: SummarisedSubscription,
  status: Extract<ReturnType<typeof subscriptionState>, { expiredAt: Date }>,
  now: Date,
): StatusSummary {
  const { state, pausesAt, deletableAt } = status
  if (state === 'grace') {
    const { ended, lastDay, pausesOn } = expiryDays(status)
    return {
      state,
      title: `Kulanz bis ${longDate(lastMoment(pausesAt))}`,
      detail: `${ENDED_PERIOD[ended]} ist am ${lastDay} abgelaufen. Vorerst funktioniert alles weiter; ab dem ${pausesOn} werden die Bretter pausiert.`,
    }
  }
  return {
    state,
    title: `Pausiert seit ${longDate(pausesAt)}`,
    detail: `${BOARDS_PAUSED} ${deletionDetail(subscription, deletableAt, now)}`,
  }
}

export function statusSummary(
  subscription: SummarisedSubscription | undefined,
  now: Date,
): StatusSummary {
  if (!subscription) {
    return {
      state: 'pending',
      title: 'Testphase',
      detail:
        'Die Testphase wird gerade eingerichtet; das dauert höchstens eine Stunde.',
    }
  }
  if (subscription.complimentary) {
    return {
      state: 'free',
      title: 'Dauerhaft freigeschaltet',
      detail: 'Dieses Konto wird nicht abgerechnet.',
    }
  }
  const status = subscriptionState(subscription, now)
  if (status.state === 'trial') {
    return {
      state: 'trial',
      title: `Testphase bis ${longDate(lastMoment(status.until))}`,
      detail: 'Danach lässt sich Kibo mit einem Abo weiter nutzen.',
    }
  }
  if (status.state === 'active') {
    // Free for good was answered above: a paid period has an end
    const until = status.until ?? now
    return {
      state: 'active',
      title: `Bezahlt bis einschließlich ${longDate(lastMoment(until))}`,
      detail: NEXT_YEAR,
    }
  }
  if (subscription.kitasDeletedAt) {
    return {
      state: 'deleted',
      title: `Kitas gelöscht am ${longDate(subscription.kitasDeletedAt)}`,
      detail:
        'Das Abo war abgelaufen, die Kitas dieses Kontos wurden gelöscht. Sobald das Abo bezahlt ist, können Sie wieder eine Kita anlegen.',
    }
  }
  return expiredSummary(subscription, status, now)
}
