import { describe, expect, test } from 'bun:test'

import { addDays, berlinDayEnd, longDate } from '@/lib/board/time'
import {
  invoiceFacts,
  periodLabel,
  priceLabel,
  setPaidCommand,
  suggestedPeriod,
} from '@/lib/hosted/billing'
import { kitaCreationVerdict } from '@/lib/hosted/kita-limit'
import { KITA_CREATION_MESSAGES } from '@/lib/hosted/messages'
import { statusSummary } from '@/lib/hosted/overview'
import { priceBreakdown, yearlyPriceEur } from '@/lib/hosted/pricing'
import {
  coverageEnd,
  deletionDueAt,
  dueReminderStage,
  isPausedState,
  subscriptionState,
  type SubscriptionDates,
} from '@/lib/hosted/state'
import { HOSTED_ORGANIZATION_CAP } from '@/lib/limits'

const trialEndsAt = new Date('2026-05-04T10:00:00.000Z')
const paidUntil = new Date('2027-05-31T22:00:00.000Z')

const trial: SubscriptionDates = {
  trialEndsAt,
  paidUntil: null,
  complimentary: false,
}
const paid: SubscriptionDates = { ...trial, paidUntil }

// A millisecond before a bound, the bound itself, and one after it
const around = (bound: Date) =>
  [-1, 0, 1].map((ms) => new Date(bound.getTime() + ms))

function statesAround(dates: SubscriptionDates, bound: Date) {
  return around(bound).map((now) => subscriptionState(dates, now).state)
}

describe('subscriptionState', () => {
  test('is a trial up to the moment the trial ends', () => {
    expect(statesAround(trial, trialEndsAt)).toEqual([
      'trial',
      'grace',
      'grace',
    ])
    expect(subscriptionState(trial, new Date('2026-04-10T10:00:00Z'))).toEqual({
      state: 'trial',
      until: trialEndsAt,
    })
  })

  test('grants 14 days of grace after the trial, then pauses', () => {
    const pausesAt = addDays(trialEndsAt, 14)
    expect(statesAround(trial, pausesAt)).toEqual(['grace', 'paused', 'paused'])
    expect(subscriptionState(trial, trialEndsAt)).toEqual({
      state: 'grace',
      ended: 'trial',
      expiredAt: trialEndsAt,
      pausesAt,
      deletableAt: addDays(trialEndsAt, 90),
    })
  })

  test('is due for deletion 90 days after the trial', () => {
    const deletableAt = addDays(trialEndsAt, 90)
    expect(statesAround(trial, deletableAt)).toEqual([
      'paused',
      'deletable',
      'deletable',
    ])
    expect(
      subscriptionState(trial, new Date('2030-01-01T00:00:00Z')).state,
    ).toBe('deletable')
  })

  test('is active up to the moment the paid period ends', () => {
    expect(statesAround(paid, paidUntil)).toEqual(['active', 'grace', 'grace'])
    expect(subscriptionState(paid, new Date('2026-12-24T10:00:00Z'))).toEqual({
      state: 'active',
      until: paidUntil,
    })
  })

  test('counts grace and deletion from the end of the paid period', () => {
    const pausesAt = addDays(paidUntil, 14)
    const deletableAt = addDays(paidUntil, 90)
    expect(statesAround(paid, pausesAt)).toEqual(['grace', 'paused', 'paused'])
    expect(statesAround(paid, deletableAt)).toEqual([
      'paused',
      'deletable',
      'deletable',
    ])
    expect(subscriptionState(paid, paidUntil)).toEqual({
      state: 'grace',
      ended: 'subscription',
      expiredAt: paidUntil,
      pausesAt,
      deletableAt,
    })
  })

  // Paying during the trial doesn't cut it short, and doesn't show as a trial
  test('a paid period beats the trial', () => {
    expect(
      subscriptionState(paid, new Date('2026-04-10T10:00:00Z')).state,
    ).toBe('active')
    expect(statesAround(paid, trialEndsAt)).toEqual([
      'active',
      'active',
      'active',
    ])
  })

  // The operator entered a date that lies before the end of the trial
  test('a paid period that ends before the trial leaves the trial running', () => {
    const early = { ...trial, paidUntil: new Date('2026-04-20T22:00:00.000Z') }
    expect(statesAround(early, early.paidUntil)).toEqual([
      'active',
      'trial',
      'trial',
    ])
    // Everything after counts from the later of the two ends
    expect(statesAround(early, trialEndsAt)).toEqual([
      'trial',
      'grace',
      'grace',
    ])
    expect(subscriptionState(early, trialEndsAt)).toMatchObject({
      expiredAt: trialEndsAt,
    })
    expect(statesAround(early, addDays(trialEndsAt, 14))).toEqual([
      'grace',
      'paused',
      'paused',
    ])
  })

  test('an account that is free for good is always active', () => {
    const free = { ...trial, complimentary: true }
    for (const now of [
      new Date('2026-01-01T00:00:00Z'),
      ...around(trialEndsAt),
      new Date('2040-01-01T00:00:00Z'),
    ]) {
      expect(subscriptionState(free, now)).toEqual({ state: 'active' })
    }
  })
})

// The deadlines count calendar days in Berlin: a year paid up to midnight is
// paused at midnight, also when the clocks changed in between — 14 times 24
// hours would pause it an hour early in autumn and name the day before
describe('the deadlines across a change of the clocks', () => {
  const midnight = (day: string) => berlinDayEnd(day)!

  test('a year paid up to 17 October is paused at midnight on 1 November', () => {
    const dates = { ...trial, paidUntil: midnight('2026-10-17') }
    const status = subscriptionState(dates, midnight('2026-10-20'))
    expect(status).toMatchObject({
      state: 'grace',
      pausesAt: midnight('2026-10-31'),
      deletableAt: midnight('2027-01-15'),
    })
    expect(statesAround(dates, midnight('2026-10-31'))).toEqual([
      'grace',
      'paused',
      'paused',
    ])
    // The hour that 14 days of 24 hours fall short by
    const naive = addDays(midnight('2026-10-17'), 14)
    expect(subscriptionState(dates, naive).state).toBe('grace')
    expect(longDate(naive)).toBe('31. Oktober 2026')
    expect(longDate(midnight('2026-10-31'))).toBe('1. November 2026')
  })

  test('the same in spring, where the hours run ahead', () => {
    const dates = { ...trial, paidUntil: midnight('2027-03-20') }
    expect(subscriptionState(dates, midnight('2027-03-21'))).toMatchObject({
      pausesAt: midnight('2027-04-03'),
      deletableAt: midnight('2027-06-18'),
    })
  })

  test('a trial that ended at noon pauses at noon', () => {
    const dates = { ...trial, trialEndsAt: new Date('2026-10-20T10:00:00Z') }
    expect(
      subscriptionState(dates, new Date('2026-10-21T10:00:00Z')),
    ).toMatchObject({
      // 12:00 in Berlin on both days: summer time, then winter time
      pausesAt: new Date('2026-11-03T11:00:00.000Z'),
    })
  })
})

describe('coverageEnd', () => {
  test('is the later of the two ends, and says which it is', () => {
    expect(coverageEnd(trial)).toEqual({ at: trialEndsAt, of: 'trial' })
    expect(coverageEnd(paid)).toEqual({ at: paidUntil, of: 'subscription' })
    const earlier = new Date('2026-04-01T22:00:00.000Z')
    expect(coverageEnd({ ...trial, paidUntil: earlier })).toEqual({
      at: trialEndsAt,
      of: 'trial',
    })
  })

  // set-paid with a day in the past, for an account without a row
  test('a paid period that ends with the trial was a subscription', () => {
    expect(coverageEnd({ ...trial, paidUntil: trialEndsAt }).of).toBe(
      'subscription',
    )
  })
})

describe('dueReminderStage', () => {
  const due = (dates: SubscriptionDates, now: Date) =>
    dueReminderStage(subscriptionState(dates, now), dates, now)
  const stagesAround = (dates: SubscriptionDates, bound: Date) =>
    around(bound).map((now) => due(dates, now))

  test('nothing is due until a week before the end', () => {
    expect(due(trial, addDays(trialEndsAt, -20))).toBe(0)
    expect(stagesAround(trial, addDays(trialEndsAt, -7))).toEqual([0, 1, 1])
    expect(stagesAround(paid, addDays(paidUntil, -7))).toEqual([0, 1, 1])
    expect(due(paid, addDays(paidUntil, -200))).toBe(0)
  })

  test('the end, the pause and the announcement follow', () => {
    expect(stagesAround(trial, trialEndsAt)).toEqual([1, 2, 2])
    expect(stagesAround(trial, addDays(trialEndsAt, 14))).toEqual([2, 3, 3])
    // Two weeks before the 90 days are over
    expect(stagesAround(trial, addDays(trialEndsAt, 76))).toEqual([3, 4, 4])
    expect(stagesAround(paid, addDays(paidUntil, 76))).toEqual([3, 4, 4])
  })

  // Nothing is deleted without it, however late the run gets to the account
  test('the announcement stays due once the deadline has passed', () => {
    expect(due(trial, addDays(trialEndsAt, 90))).toBe(4)
    expect(due(trial, addDays(trialEndsAt, 900))).toBe(4)
  })

  test('an account that is free for good is never reminded', () => {
    const free = { ...trial, complimentary: true }
    for (const days of [-7, 0, 14, 90, 900]) {
      expect(due(free, addDays(trialEndsAt, days))).toBe(0)
    }
  })

  // Paid up to a day before the trial ends: the trial is what runs out
  test('a paid period that ends before the trial is not the end', () => {
    const dates = { ...trial, paidUntil: addDays(trialEndsAt, -10) }
    expect(due(dates, addDays(trialEndsAt, -15))).toBe(0)
    expect(due(dates, addDays(trialEndsAt, -12))).toBe(0)
    expect(due(dates, addDays(trialEndsAt, -7))).toBe(1)
  })
})

describe('deletionDueAt', () => {
  const deletableAt = new Date('2026-08-02T10:00:00.000Z')

  test('is the deadline when the announcement went out in time', () => {
    expect(deletionDueAt(deletableAt, addDays(deletableAt, -14))).toEqual(
      deletableAt,
    )
    expect(deletionDueAt(deletableAt, addDays(deletableAt, -30))).toEqual(
      deletableAt,
    )
  })

  test('is two weeks after an announcement that came late', () => {
    expect(deletionDueAt(deletableAt, addDays(deletableAt, -13))).toEqual(
      addDays(deletableAt, 1),
    )
    const late = new Date('2027-02-01T09:00:00.000Z')
    expect(deletionDueAt(deletableAt, late)).toEqual(
      new Date('2027-02-15T09:00:00.000Z'),
    )
  })
})

describe('statusSummary', () => {
  const at = (date: string) => new Date(date)

  test('names the last day of a trial and of a paid period', () => {
    expect(statusSummary(trial, at('2026-04-20T10:00:00Z'))).toMatchObject({
      state: 'trial',
      title: 'Testphase bis 4. Mai 2026',
    })
    // Paid up to midnight after 31 May
    expect(statusSummary(paid, at('2026-12-24T10:00:00Z'))).toMatchObject({
      state: 'active',
      title: 'Bezahlt bis einschließlich 31. Mai 2027',
    })
  })

  test('says what ran out and when the boards are paused', () => {
    expect(statusSummary(paid, at('2027-06-05T10:00:00Z'))).toEqual({
      state: 'grace',
      title: 'Kulanz bis 14. Juni 2027',
      detail:
        'Das Abo ist am 31. Mai 2027 abgelaufen. Vorerst funktioniert alles weiter; ab dem 15. Juni 2027 werden die Bretter pausiert.',
    })
    expect(statusSummary(trial, at('2026-05-10T10:00:00Z')).detail).toStartWith(
      'Die Testphase ist am 4. Mai 2026 abgelaufen.',
    )
  })

  test('says since when a subscription is paused and when the Kitas go', () => {
    // Not announced yet: the deadline is the earliest day
    expect(statusSummary(trial, at('2026-06-01T10:00:00Z'))).toMatchObject({
      state: 'paused',
      title: 'Pausiert seit 18. Mai 2026',
      detail: expect.stringContaining(
        'werden die Kitas frühestens am 2. August 2026 gelöscht.',
      ),
    })
    // Announced in time: the deadline is the day
    expect(
      statusSummary(
        { ...trial, deletionNoticeAt: at('2026-07-19T10:00:00Z') },
        at('2026-07-25T10:00:00Z'),
      ).detail,
    ).toContain('werden die Kitas am 2. August 2026 gelöscht.')
    // Long past the deadline and only announced now: two weeks from then
    expect(
      statusSummary(
        { ...trial, deletionNoticeAt: at('2027-01-10T09:00:00Z') },
        at('2027-01-12T10:00:00Z'),
      ),
    ).toMatchObject({
      state: 'deletable',
      detail: expect.stringContaining(
        'werden die Kitas am 24. Januar 2027 gelöscht.',
      ),
    })
    expect(statusSummary(trial, at('2027-01-12T10:00:00Z')).detail).toContain(
      'frühestens am 26. Januar 2027',
    )
    // The operator holds the deletion after a request to switch or to erase:
    // no day is computed, the page names the last held day instead
    const held = { ...trial, deletionHeldUntil: at('2026-09-30T22:00:00Z') }
    for (const now of ['2026-07-25T10:00:00Z', '2026-09-30T21:59:00Z']) {
      const { detail } = statusSummary(held, at(now))
      expect(detail).toEndWith(
        'Sie haben einen Wechsel des Anbieters oder die Löschung der Daten verlangt. Bis einschließlich 30. September 2026 wird deshalb nichts automatisch gelöscht; bis dahin lassen sich die Daten unter „Kita-Einstellungen“ exportieren.',
      )
      expect(detail).not.toContain('frühestens')
    }
    // Over: as before
    expect(statusSummary(held, at('2026-10-02T10:00:00Z')).detail).toContain(
      'frühestens am 16. Oktober 2026',
    )
    // Until then the data can be taken along
    expect(statusSummary(trial, at('2026-06-01T10:00:00Z')).detail).toEndWith(
      'Bis zur Löschung lassen sich die Daten unter „Kita-Einstellungen“ exportieren.',
    )
  })

  test('says when the Kitas were deleted, until the account has paid again', () => {
    const deleted = { ...trial, kitasDeletedAt: at('2026-08-03T10:00:00Z') }
    expect(statusSummary(deleted, at('2026-09-01T10:00:00Z'))).toMatchObject({
      state: 'deleted',
      title: 'Kitas gelöscht am 3. August 2026',
    })
    expect(
      statusSummary({ ...deleted, paidUntil }, at('2026-09-01T10:00:00Z'))
        .state,
    ).toBe('active')
  })

  test('an account that is free for good and one without a row', () => {
    expect(
      statusSummary({ ...trial, complimentary: true }, at('2030-01-01T00:00Z')),
    ).toMatchObject({ state: 'free', title: 'Dauerhaft freigeschaltet' })
    expect(statusSummary(undefined, at('2026-05-01T00:00Z')).state).toBe(
      'pending',
    )
  })
})

describe('priceBreakdown', () => {
  const pricing = {
    priceEur: 49,
    includedKitas: 3,
    extraKitaEur: 10,
    trialDays: 30,
  }

  test('splits the yearly price into the base and the Kitas beyond it', () => {
    expect(priceBreakdown(1, pricing)).toEqual({
      baseEur: 49,
      includedKitas: 3,
      extraKitas: 0,
      extraKitaEur: 10,
      extraEur: 0,
      totalEur: 49,
    })
    expect(priceBreakdown(5, pricing)).toMatchObject({
      extraKitas: 2,
      extraEur: 20,
      totalEur: 69,
    })
    // An account whose Kitas were deleted pays the base price
    expect(priceBreakdown(0, pricing).totalEur).toBe(49)
  })

  test('adds up to what yearlyPriceEur says', () => {
    for (let kitas = 0; kitas <= 8; kitas++) {
      const price = priceBreakdown(kitas, pricing)
      expect(price.baseEur + price.extraEur).toBe(price.totalEur)
      expect(price.totalEur).toBe(yearlyPriceEur(kitas, pricing))
    }
  })

  test('is written out with how it comes about', () => {
    expect(priceLabel(priceBreakdown(2, pricing))).toBe(
      '49 € (49 € inkl. 3 Kitas)',
    )
    expect(priceLabel(priceBreakdown(4, pricing))).toBe(
      '59 € (49 € inkl. 3 Kitas + 1 × 10 €)',
    )
    expect(
      priceLabel(
        priceBreakdown(3, { ...pricing, priceEur: 30, includedKitas: 1 }),
      ),
    ).toBe('50 € (30 € inkl. 1 Kita + 2 × 10 €)')
  })
})

describe('suggestedPeriod', () => {
  const now = new Date('2026-09-30T13:00:00.000Z')

  test('starts today for an account that is not paid for', () => {
    for (const paidBefore of [null, undefined, new Date('2026-06-30T22:00Z')]) {
      const period = suggestedPeriod(paidBefore, now)
      expect(period).toEqual({
        from: now,
        until: berlinDayEnd('2027-09-30')!,
        setPaidDay: '2027-09-30',
      })
      expect(periodLabel(period)).toBe(
        '30. September 2026 bis 30. September 2027',
      )
    }
  })

  // Paid up to and including 31 December: the next year is the calendar year
  test('follows a paid period that still runs, on the same day of the year', () => {
    const period = suggestedPeriod(berlinDayEnd('2026-12-31'), now)
    expect(period).toEqual({
      from: berlinDayEnd('2026-12-31')!,
      until: berlinDayEnd('2027-12-31')!,
      setPaidDay: '2027-12-31',
    })
    expect(periodLabel(period)).toBe('1. Januar 2027 bis 31. Dezember 2027')
    // Year after year, the day stays where it is
    expect(suggestedPeriod(period.until, now).setPaidDay).toBe('2028-12-31')
  })

  test('a year that ends on 29 February is followed by one that ends on the 28th', () => {
    expect(suggestedPeriod(berlinDayEnd('2028-02-29'), now).setPaidDay).toBe(
      '2029-02-28',
    )
    expect(
      suggestedPeriod(null, new Date('2028-02-29T10:00:00Z')).setPaidDay,
    ).toBe('2029-02-28')
  })

  test('comes with the call that records the payment', () => {
    expect(
      setPaidCommand('leitung@kita.example', suggestedPeriod(null, now)),
    ).toBe(
      'node dist/admin.mjs set-paid --email leitung@kita.example --until 2027-09-30',
    )
  })

  // Pasted into a shell: an address may hold what a shell would act on
  test('quotes an address a shell would not take as one word', () => {
    const period = suggestedPeriod(null, now)
    expect(setPaidCommand("o'connor@example.org", period)).toBe(
      String.raw`node dist/admin.mjs set-paid --email 'o'\''connor@example.org' --until 2027-09-30`,
    )
    expect(setPaidCommand('a$(id)`id`&b@example.org', period)).toBe(
      "node dist/admin.mjs set-paid --email 'a$(id)`id`&b@example.org' --until 2027-09-30",
    )
    expect(setPaidCommand('vor.nach+kita-1@kita-beispiel.de', period)).toBe(
      'node dist/admin.mjs set-paid --email vor.nach+kita-1@kita-beispiel.de --until 2027-09-30',
    )
  })

  test('the lines the operator gets carry the quoted call', () => {
    const { operator } = invoiceFacts(
      { email: "o'connor@example.org", kitas: ['Kita Sonnenschein'] },
      {
        billingName: 'Kita Sonnenschein e. V.',
        billingAddress: 'Musterweg 1\n12345 Berlin',
        billingEmail: 'rechnung@kita.example',
        billingReference: null,
      },
      { priceEur: 49, includedKitas: 3, extraKitaEur: 10, trialDays: 30 },
      now,
    )
    expect(operator.at(-1)).toEqual({
      label: 'Nach Zahlungseingang',
      value: String.raw`node dist/admin.mjs set-paid --email 'o'\''connor@example.org' --until 2027-09-30`,
    })
  })
})

describe('isPausedState', () => {
  test('pauses a Kita only once the grace period is over', () => {
    expect(isPausedState('trial')).toBe(false)
    expect(isPausedState('active')).toBe(false)
    expect(isPausedState('grace')).toBe(false)
    expect(isPausedState('paused')).toBe(true)
    expect(isPausedState('deletable')).toBe(true)
  })
})

describe('yearlyPriceEur', () => {
  const pricing = {
    priceEur: 49,
    includedKitas: 3,
    extraKitaEur: 10,
    trialDays: 30,
  }

  test('is the base price up to the included Kitas', () => {
    for (const owned of [0, 1, 3]) {
      expect(yearlyPriceEur(owned, pricing)).toBe(49)
    }
  })

  test('adds the extra for every Kita beyond them', () => {
    expect(yearlyPriceEur(4, pricing)).toBe(59)
    expect(yearlyPriceEur(10, pricing)).toBe(119)
    expect(yearlyPriceEur(HOSTED_ORGANIZATION_CAP, pricing)).toBe(219)
  })

  test('follows the configured numbers', () => {
    const other = { ...pricing, priceEur: 0, includedKitas: 0, extraKitaEur: 5 }
    expect(yearlyPriceEur(0, other)).toBe(0)
    expect(yearlyPriceEur(2, other)).toBe(10)
  })

  test('is nothing for an account that is free for good', () => {
    expect(yearlyPriceEur(1, pricing, true)).toBe(0)
    expect(yearlyPriceEur(12, pricing, true)).toBe(0)
    expect(yearlyPriceEur(12, pricing, false)).toBe(139)
  })
})

describe('kitaCreationVerdict', () => {
  test('the first Kita needs no subscription: the trial starts with it', () => {
    expect(kitaCreationVerdict({ owned: 0 })).toBeUndefined()
    expect(kitaCreationVerdict({ state: 'trial', owned: 0 })).toBeUndefined()
  })

  test('the trial is for one Kita', () => {
    expect(kitaCreationVerdict({ state: 'trial', owned: 1 })).toBe(
      'HOSTED_TRIAL_ONE_KITA',
    )
    expect(kitaCreationVerdict({ owned: 2 })).toBe('HOSTED_TRIAL_ONE_KITA')
  })

  test('a paid subscription takes more, up to the ceiling', () => {
    for (const owned of [0, 1, 3, 4, HOSTED_ORGANIZATION_CAP - 1]) {
      expect(kitaCreationVerdict({ state: 'active', owned })).toBeUndefined()
    }
    expect(
      kitaCreationVerdict({ state: 'active', owned: HOSTED_ORGANIZATION_CAP }),
    ).toBe('HOSTED_KITA_LIMIT')
    expect(
      kitaCreationVerdict({
        state: 'active',
        owned: HOSTED_ORGANIZATION_CAP + 1,
      }),
    ).toBe('HOSTED_KITA_LIMIT')
  })

  test('no new Kitas once the subscription has run out', () => {
    for (const state of ['grace', 'paused', 'deletable'] as const) {
      for (const owned of [0, 1, 5]) {
        expect(kitaCreationVerdict({ state, owned })).toBe(
          'HOSTED_SUBSCRIPTION_INACTIVE',
        )
      }
    }
  })

  test('every refusal has a sentence to show', () => {
    expect(KITA_CREATION_MESSAGES.HOSTED_KITA_LIMIT).toContain(
      `höchstens ${HOSTED_ORGANIZATION_CAP} Kitas`,
    )
    expect(Object.keys(KITA_CREATION_MESSAGES).toSorted()).toEqual([
      'HOSTED_KITA_LIMIT',
      'HOSTED_SUBSCRIPTION_INACTIVE',
      'HOSTED_TRIAL_ONE_KITA',
    ])
  })
})
