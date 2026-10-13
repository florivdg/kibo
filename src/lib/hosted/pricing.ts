import type { HostedPricing } from '../../../scripts/instance-config.mjs'

// What the hosted instance charges (HOSTED_*): whole euros a year, the Kitas
// that includes, whole euros a year for each Kita beyond them, and the days
// of the trial. Defined where it is parsed, scripts/instance-config.mjs.
export type { HostedPricing }

export interface PriceBreakdown {
  // The base price and the Kitas it includes
  baseEur: number
  includedKitas: number
  // The Kitas beyond them, what each costs and what they add up to
  extraKitas: number
  extraKitaEur: number
  extraEur: number
  totalEur: number
}

// What an account that owns `ownedKitas` Kitas owes for a year, and how that
// comes about: the base price, plus the extra for every Kita it owns beyond
// the included ones. Kitas it was invited to are somebody else's.
export function priceBreakdown(
  ownedKitas: number,
  { priceEur, includedKitas, extraKitaEur }: HostedPricing,
): PriceBreakdown {
  const extraKitas = Math.max(0, ownedKitas - includedKitas)
  const extraEur = extraKitas * extraKitaEur
  return {
    baseEur: priceEur,
    includedKitas,
    extraKitas,
    extraKitaEur,
    extraEur,
    totalEur: priceEur + extraEur,
  }
}

// The amount alone. An account that is free for good owes nothing.
export function yearlyPriceEur(
  ownedKitas: number,
  pricing: HostedPricing,
  complimentary = false,
): number {
  return complimentary ? 0 : priceBreakdown(ownedKitas, pricing).totalEur
}
