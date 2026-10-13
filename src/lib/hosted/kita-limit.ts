import { HOSTED_ORGANIZATION_CAP } from '@/lib/limits'

import type { SubscriptionState } from './state'

// Why an account of the hosted instance may not create another Kita; the
// messages are in ./messages.ts
export type KitaCreationRefusal =
  'HOSTED_TRIAL_ONE_KITA' | 'HOSTED_SUBSCRIPTION_INACTIVE' | 'HOSTED_KITA_LIMIT'

// Whether an account that owns `owned` Kitas may create one more. The trial
// is for one Kita; a paid subscription takes more — a Kita beyond the
// included ones works right away and shows up in the next invoice — up to a
// ceiling no Träger reaches. Once the subscription has run out, grace period
// included, there are no new Kitas. Without a state there is no subscription
// yet: the trial starts with the first Kita.
export function kitaCreationVerdict({
  state = 'trial',
  owned,
}: {
  state?: SubscriptionState
  owned: number
}): KitaCreationRefusal | undefined {
  if (state === 'trial') {
    return owned >= 1 ? 'HOSTED_TRIAL_ONE_KITA' : undefined
  }
  if (state !== 'active') return 'HOSTED_SUBSCRIPTION_INACTIVE'
  return owned >= HOSTED_ORGANIZATION_CAP ? 'HOSTED_KITA_LIMIT' : undefined
}
