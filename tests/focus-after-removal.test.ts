import { describe, expect, test } from 'bun:test'

import {
  landingAfterRemoval,
  neighbourAfterRemoval,
  restoreFocusAfterRemoval,
} from '@/lib/board/focus-after-removal'

// Where the focus lands once a note is gone (src/lib/board/focus-after-removal.ts)

describe('neighbourAfterRemoval', () => {
  test('moves on to the next entry', () => {
    expect(neighbourAfterRemoval(['a', 'b', 'c'], 'a')).toBe('b')
    expect(neighbourAfterRemoval(['a', 'b', 'c'], 'b')).toBe('c')
  })

  test('goes back to the previous one at the end', () => {
    expect(neighbourAfterRemoval(['a', 'b', 'c'], 'c')).toBe('b')
  })

  test('has nowhere to go once the list is empty', () => {
    expect(neighbourAfterRemoval(['a'], 'a')).toBeNull()
    expect(neighbourAfterRemoval([], 'a')).toBeNull()
  })

  test('has nowhere to go for an entry that was not listed', () => {
    expect(neighbourAfterRemoval(['a', 'b'], 'x')).toBeNull()
  })
})

describe('logical focus across masonry redistribution', () => {
  test('a delayed removal keeps the different note focused while it remounts', async () => {
    const removed = { id: 'a', isConnected: true }
    const other = { id: 'c', isConnected: true }
    const body = { id: 'body', isConnected: true }
    const page = { activeElement: removed, body }
    const focusedAfterRender: { id: string | null } = { id: null }
    const response = Promise.withResolvers<void>()
    const finished = response.promise.then(() => {
      // Snapshot at response time, before the focused card is remounted into
      // a new column and the browser falls back to the body.
      const trigger = page.activeElement
      const id = landingAfterRemoval(['a', 'b', 'c'], 'a', trigger.id)
      trigger.isConnected = false
      page.activeElement = body
      restoreFocusAfterRemoval(
        trigger,
        { focus: () => (focusedAfterRender.id = id) },
        page,
      )
    })
    page.activeElement = other
    response.resolve()
    await finished
    expect(focusedAfterRender.id).toBe('c')
  })

  test('uses the neighbour when the removed note or its dialog owned focus', () => {
    expect(landingAfterRemoval(['a', 'b', 'c'], 'a', 'a')).toBe('b')
    expect(landingAfterRemoval(['a', 'b', 'c'], 'a', null)).toBe('b')
    expect(landingAfterRemoval(['a'], 'a', null)).toBeNull()
  })
})

describe('focus after an async removal', () => {
  function fixture() {
    const trigger = { isConnected: true }
    const body = { isConnected: true }
    const elsewhere = { isConnected: true }
    const page = { activeElement: trigger, body }
    let restored = 0
    const target = { focus: () => restored++ }
    return { trigger, body, elsewhere, page, target, restored: () => restored }
  }

  // The action finishes later; focus is read at completion, after the trigger
  // has gone, rather than remembered when the request was sent.
  function removeLater(state: ReturnType<typeof fixture>) {
    const response = Promise.withResolvers<void>()
    const finished = response.promise.then(() => {
      state.trigger.isConnected = false
      if (state.page.activeElement === state.trigger) {
        state.page.activeElement = state.body
      }
      restoreFocusAfterRemoval(state.trigger, state.target, state.page)
    })
    return { resolve: response.resolve, finished }
  }

  test('restores focus when the dialog returned it to the disappearing trigger', async () => {
    const state = fixture()
    const response = removeLater(state)
    response.resolve()
    await response.finished
    expect(state.restored()).toBe(1)
  })

  test('a delayed response keeps focus where the person moved after closing the dialog', async () => {
    const state = fixture()
    const response = removeLater(state)
    state.page.activeElement = state.elsewhere
    response.resolve()
    await response.finished
    expect(state.restored()).toBe(0)
  })

  test('does not move focus after the person blurred a trigger that still exists', () => {
    const state = fixture()
    state.page.activeElement = state.body
    restoreFocusAfterRemoval(state.trigger, state.target, state.page)
    expect(state.restored()).toBe(0)
  })

  test('does not claim focus when the originating trigger was already gone', () => {
    const state = fixture()
    state.page.activeElement = state.body
    restoreFocusAfterRemoval(null, state.target, state.page)
    expect(state.restored()).toBe(0)
  })

  test('uses the page heading when the neighbour is gone', () => {
    const state = fixture()
    restoreFocusAfterRemoval(state.trigger, null, state.page, state.target)
    expect(state.restored()).toBe(1)
  })

  test('prefers the neighbouring control over the page heading', () => {
    const state = fixture()
    let fallbackFocused = false
    restoreFocusAfterRemoval(state.trigger, state.target, state.page, {
      focus: () => (fallbackFocused = true),
    })
    expect(state.restored()).toBe(1)
    expect(fallbackFocused).toBe(false)
  })
})
