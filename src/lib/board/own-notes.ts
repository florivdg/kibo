// The delete keys of notes pinned from this browser, by note id for all
// boards, so they keep working when the Kita renews its link
// (src/composables/use-own-note-keys.ts keeps the record). They don't touch
// the browser, so tests can call them directly.

export interface OwnNote {
  key: string
  expiresAt: string
}

export type OwnNotes = Record<string, OwnNote>

// The record without the keys of notes that have expired by `now` — the
// note is gone for good, and its key with it. Null once nothing is left, so
// the entry goes as well.
export function liveOwnNotes(own: OwnNotes | null, now: Date) {
  const at = now.toISOString()
  const live = Object.entries(own ?? {}).filter(
    ([, note]) => note?.expiresAt > at,
  )
  return live.length ? Object.fromEntries(live) : null
}
