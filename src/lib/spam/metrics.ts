// Counts of what the spam rules did, so an operator can see whether a board
// is under pressure — plus how web push deliveries went, which answers the
// same question for parents' phones. Deliberately nothing but event names and
// numbers: no IP addresses, no board tokens, no note text, no mail addresses,
// links or push endpoints.

export type SpamEvent =
  | 'note:allowed'
  | 'note:limited'
  | 'note:board-limited'
  | 'note:duplicate'
  | 'note:honeypot'
  | 'note:token'
  | 'note:unavailable'
  | 'note:list-limited'
  | 'note:remove-limited'
  | 'report:allowed'
  | 'report:limited'
  | 'report:board-limited'
  | 'report:duplicate'
  | 'report:honeypot'
  | 'report:unavailable'
  | 'report:mail-sent'
  | 'report:mail-failed'
  | 'report:mail-throttled'
  | 'report:mail-given-up'
  | 'report:operator-limited'
  | 'report:operator-sent'
  | 'report:operator-failed'
  | 'mail:allowed'
  | 'mail:limited'
  | 'mail:unavailable'
  | 'signin:limited'
  | 'signin:unavailable'
  | 'invite:limited'
  | 'invite:unavailable'
  | 'invoice:limited'
  | 'invoice:unavailable'
  | 'export:limited'
  | 'export:unavailable'
  | 'push:subscribed'
  | 'push:request-limited'
  | 'push:subscribe-limited'
  | 'push:board-full'
  | 'push:throttled'
  | 'push:unavailable'
  | 'push:sent'
  | 'push:gone'
  | 'push:failed'
  | 'analytics:limited'
  | 'analytics:unavailable'

const counts = new Map<SpamEvent, number>()

export function countSpamEvent(event: SpamEvent, amount = 1) {
  counts.set(event, (counts.get(event) ?? 0) + amount)
}

function logLine(prefix: string, entries: [SpamEvent, number][]) {
  if (!entries.length) return
  console.info(prefix, JSON.stringify(Object.fromEntries(entries)))
}

// Writes the tally out and starts over. Called on the server's hourly timer
// and once more while shutting down, both in src/lib/server/runtime.ts —
// hanging it off the next event instead would keep the numbers of a burst out
// of the log for as long as nothing happens afterwards. The push:* events get
// a line of their own, so a busy board's deliveries don't bury the rest.
export function flushSpamCounts() {
  const entries = [...counts]
  const isPush = ([event]: [SpamEvent, number]) => event.startsWith('push:')
  logLine(
    '[spam]',
    entries.filter((entry) => !isPush(entry)),
  )
  logLine('[push]', entries.filter(isPush))
  counts.clear()
}
