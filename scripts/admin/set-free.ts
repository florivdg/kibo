import {
  grantComplimentary,
  revokeComplimentary,
} from '@/lib/hosted/subscriptions'

import { CommandError, type Command } from './command'
import { accountByEmail, describeSubscription, pricingFrom } from './hosted'

// An account the hosted instance never bills: the operator's own, above all.
// Its Kitas are never paused, whatever the dates of its subscription say.
export const setFreeCommand: Command = {
  summary: 'Schaltet ein Konto dauerhaft kostenfrei (oder nimmt das zurück)',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
    revoke: { help: 'Freischaltung aufheben' },
  },
  notes: [
    'Ein kostenfreies Konto ist immer aktiv und wird nie pausiert. Mit --revoke',
    'gilt wieder das Abo; war es abgelaufen, beginnt eine neue Testphase.',
  ],
  async run({ values: { email = '' }, flags }, { db, io, env, now }) {
    const account = await accountByEmail(db, email)
    if (!flags.revoke) {
      await grantComplimentary(db, account.id, now)
      io.stdout.write(
        `[admin] ${account.email} ist dauerhaft kostenfrei freigeschaltet.\n`,
      )
      return
    }
    const { trialDays } = pricingFrom(env)
    const subscription = await revokeComplimentary(
      db,
      account.id,
      now,
      trialDays,
    )
    if (!subscription) {
      throw new CommandError(`${account.email} ist nicht freigeschaltet`)
    }
    const { label } = describeSubscription(subscription, now)
    io.stdout.write(
      `[admin] Freischaltung für ${account.email} aufgehoben (Zustand: ${label}).\n`,
    )
  },
}
