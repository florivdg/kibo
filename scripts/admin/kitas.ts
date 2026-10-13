import { listKitasWithOwner } from '@/lib/hosted/subscriptions'

import type { Command } from './command'
import { describeSubscription, JSON_FLAG, NONE, writeList } from './hosted'

const NO_OWNER = 'ohne Inhaber:in'

// Every Kita of the instance, and where the subscription of its owner stands
export const kitasCommand: Command = {
  summary: 'Listet die Kitas: Inhaber:in, Bretter, Mitglieder, Zustand',
  options: JSON_FLAG,
  notes: [
    'Der Zustand ist der des Abos der Inhaberin oder des Inhabers; er gilt',
    'für alle Kitas dieses Kontos.',
  ],
  async run({ flags }, { db, io, now }) {
    const kitas = (await listKitasWithOwner(db)).map(
      ({ subscription, ...kita }) => {
        const { state, label } = describeSubscription(subscription, now)
        return {
          kita: { ...kita, state },
          label: kita.ownerEmail === null ? NO_OWNER : label,
        }
      },
    )
    writeList(io, flags.json, {
      rows: kitas,
      json: ({ kita }) => kita,
      empty: 'Keine Kitas.',
      headings: ['Kita', 'Inhaber:in', 'Bretter', 'Mitglieder', 'Zustand'],
      cells: ({ kita, label }) => [
        kita.name,
        kita.ownerEmail ?? NONE,
        kita.boards,
        kita.members,
        label,
      ],
    })
  },
}
