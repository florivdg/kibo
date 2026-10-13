// Where the focus goes once an entry of a list is gone, taking the focused
// control with it: the entry after it, the one before it at the end, null
// once the list is empty (or the entry wasn't in it). No DOM, so tests call
// it directly; the board page and the admin's note table use it.
export function neighbourAfterRemoval(
  ids: readonly string[],
  removedId: string,
): string | null {
  const at = ids.indexOf(removedId)
  if (at === -1) return null
  return ids[at + 1] ?? ids[at - 1] ?? null
}

// Masonry may remount a different focused note when columns redistribute.
// Keep that note's logical focus; only the removed note needs a neighbour.
export function landingAfterRemoval(
  ids: readonly string[],
  removedId: string,
  focusedId: string | null,
): string | null {
  if (focusedId && focusedId !== removedId) return focusedId
  return neighbourAfterRemoval(ids, removedId)
}

// An async removal may finish after the person has moved on. Restore only
// while focus is still on its trigger, or fell back to the body when that
// trigger disappeared. Read the current focus after the DOM update.
export function restoreFocusAfterRemoval<T extends { isConnected: boolean }>(
  trigger: T | null,
  target: { focus(): void } | null,
  page: { activeElement: T | null; body: T },
  fallback?: { focus(): void } | null,
) {
  if (!trigger) return
  const { activeElement, body } = page
  if (
    activeElement === trigger ||
    (activeElement === body && !trigger.isConnected)
  ) {
    const destination = target ?? fallback
    destination?.focus()
  }
}
