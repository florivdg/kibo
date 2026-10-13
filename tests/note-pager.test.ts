import { describe, expect, test } from 'bun:test'

import { useNotePager } from '@/composables/use-note-pager'
import type { Note, NoteCursor, NotePage } from '@/lib/board/types'

// Notes named by their order: each one's createdAt is its id
const note = (id: string) => ({ id, createdAt: id }) as Note
const page = (hasMore: boolean, ...ids: string[]): NotePage => ({
  notes: ids.map(note),
  hasMore,
})

// A pager showing `current` whose server hands out `newest` as first page
function pagerWith(current: NotePage, newest: NotePage) {
  return useNotePager(async (cursor) => {
    expect(cursor).toBeUndefined()
    return { data: newest }
  }, current)
}

const ids = (notes: Note[]) => notes.map(({ id }) => id)

// A pager whose requests the test answers by hand, in any order
function manualPager(current: NotePage) {
  const requests: { cursor?: NoteCursor; answer: (data: NotePage) => void }[] =
    []
  const pager = useNotePager(
    (cursor) =>
      new Promise((resolve) => {
        requests.push({ cursor, answer: (data) => resolve({ data }) })
      }),
    current,
  )
  return { pager, requests }
}

describe('loadNewest', () => {
  test('puts new notes on top and keeps older pages', async () => {
    for (const hasMore of [true, false]) {
      const pager = pagerWith(
        page(hasMore, 'c', 'b', 'a'),
        page(hasMore, 'e', 'd', 'c'),
      )
      expect(await pager.loadNewest()).toBe(2)
      expect(ids(pager.notes.value)).toEqual(['e', 'd', 'c', 'b', 'a'])
      expect(pager.hasMore.value).toBe(hasMore)
    }
  })

  test('nothing new leaves the list alone', async () => {
    const pager = pagerWith(page(false, 'b', 'a'), page(false, 'b', 'a'))
    expect(await pager.loadNewest()).toBe(0)
    expect(ids(pager.notes.value)).toEqual(['b', 'a'])
    expect(pager.hasMore.value).toBe(false)
  })

  test('more new notes than a page restart the list instead of a gap', async () => {
    const pager = pagerWith(page(false, 'b', 'a'), page(true, 'z', 'y'))
    expect(await pager.loadNewest()).toBe(2)
    expect(ids(pager.notes.value)).toEqual(['z', 'y'])
    expect(pager.hasMore.value).toBe(true)
  })

  test('a failed request changes nothing', async () => {
    const current = page(true, 'b', 'a')
    const pager = useNotePager(
      async () => ({ error: { code: 'NOT_FOUND' } }),
      current,
    )
    expect(await pager.loadNewest()).toBe(0)
    expect(ids(pager.notes.value)).toEqual(['b', 'a'])
    expect(pager.hasMore.value).toBe(true)
  })
})

describe('loadMore', () => {
  test('goes on from the last note sent, even once it was taken down', async () => {
    const { pager, requests } = manualPager(page(true, 'c', 'b'))
    pager.notes.value = []

    const more = pager.loadMore()
    expect(requests[0]?.cursor).toEqual({ createdAt: 'b', id: 'b' })
    requests[0]?.answer(page(false, 'a'))
    await more
    expect(ids(pager.notes.value)).toEqual(['a'])
    expect(pager.loadedUntil.value).toBe('c')
  })

  test('goes on from the restarted page after a restart', async () => {
    const { pager, requests } = manualPager(page(true, 'c', 'b'))
    const newest = pager.loadNewest()
    requests[0]?.answer(page(true, 'g', 'f'))
    await newest

    void pager.loadMore()
    expect(requests[1]?.cursor).toEqual({ createdAt: 'f', id: 'f' })
  })
})

// How far up the screen holds every note (BoardApp.vue counts the board as
// seen up to there, for the app's icon)
describe('loadedUntil', () => {
  test('starts at the newest note of the first page', () => {
    expect(pagerWith(page(true, 'c', 'b'), page(true)).loadedUntil.value).toBe(
      'c',
    )
    expect(pagerWith(page(false), page(false)).loadedUntil.value).toBe('')
  })

  test('a note pinned here moves it only once a page brings what came before', async () => {
    // Loaded with c, b, a; then someone else pins d and this page pins e
    const pager = pagerWith(
      page(true, 'c', 'b', 'a'),
      page(true, 'e', 'd', 'c'),
    )
    pager.notes.value = [note('e'), ...pager.notes.value]
    expect(pager.loadedUntil.value).toBe('c')

    expect(await pager.loadNewest()).toBe(1)
    expect(ids(pager.notes.value)).toEqual(['d', 'e', 'c', 'b', 'a'])
    expect(pager.loadedUntil.value).toBe('e')
  })

  test('a page that leaves a gap moves nothing, even with the own note in it', async () => {
    // Pages of two: d and more were pinned elsewhere before e
    const pager = pagerWith(page(true, 'c', 'b', 'a'), page(true, 'e', 'd'))
    pager.notes.value = [note('e'), ...pager.notes.value]

    expect(await pager.loadNewest()).toBe(1)
    expect(ids(pager.notes.value)).toEqual(['e', 'd'])
    expect(pager.hasMore.value).toBe(true)
    expect(pager.loadedUntil.value).toBe('c')
  })

  test('the last page closes any gap', async () => {
    const pager = pagerWith(page(false), page(false, 'b', 'a'))
    expect(await pager.loadNewest()).toBe(2)
    expect(pager.loadedUntil.value).toBe('b')
  })

  test('a restarted list keeps it until older pages close the gap', async () => {
    // Pages of two: loaded with c, b; then g, f and more came in
    const pages = [
      page(true, 'g', 'f'),
      page(true, 'e', 'd'),
      page(true, 'c', 'b'),
    ]
    const pager = useNotePager(
      async () => ({ data: pages.shift() }),
      page(false, 'c', 'b'),
    )

    await pager.loadNewest()
    expect(ids(pager.notes.value)).toEqual(['g', 'f'])
    expect(pager.loadedUntil.value).toBe('c')

    await pager.loadMore()
    expect(pager.loadedUntil.value).toBe('c')
    await pager.loadMore()
    expect(ids(pager.notes.value)).toEqual(['g', 'f', 'e', 'd', 'c', 'b'])
    expect(pager.loadedUntil.value).toBe('g')
  })

  test('a restarted list takes newer pages on top again', async () => {
    const pages = [
      page(true, 'g', 'f'),
      page(true, 'e', 'd'),
      page(true, 'h', 'g'),
    ]
    const pager = useNotePager(
      async () => ({ data: pages.shift() }),
      page(false, 'c', 'b'),
    )

    await pager.loadNewest()
    await pager.loadMore()
    expect(await pager.loadNewest()).toBe(1)
    expect(ids(pager.notes.value)).toEqual(['h', 'g', 'f', 'e', 'd'])
    expect(pager.loadedUntil.value).toBe('c')
  })

  test('an older page asked for before a restart is dropped', async () => {
    // Pages of two: loaded with c, b; then g, f and more came in
    const { pager, requests } = manualPager(page(true, 'c', 'b'))
    const more = pager.loadMore()
    expect(requests[0]?.cursor).toEqual({ createdAt: 'b', id: 'b' })

    const newest = pager.loadNewest()
    requests[1]?.answer(page(true, 'g', 'f'))
    expect(await newest).toBe(2)

    requests[0]?.answer(page(false, 'a'))
    await more
    expect(ids(pager.notes.value)).toEqual(['g', 'f'])
    expect(pager.hasMore.value).toBe(true)
    expect(pager.loadedUntil.value).toBe('c')
    expect(pager.status.value).toBe('')

    // Older pages go on from the restarted list and close the gap
    const next = pager.loadMore()
    expect(requests[2]?.cursor).toEqual({ createdAt: 'f', id: 'f' })
    requests[2]?.answer(page(true, 'e', 'd'))
    await next
    expect(pager.loadedUntil.value).toBe('c')
    const last = pager.loadMore()
    expect(requests[3]?.cursor).toEqual({ createdAt: 'd', id: 'd' })
    requests[3]?.answer(page(true, 'c', 'b'))
    await last
    expect(ids(pager.notes.value)).toEqual(['g', 'f', 'e', 'd', 'c', 'b'])
    expect(pager.loadedUntil.value).toBe('g')
  })

  test('a newest page asked for before a restart is dropped', async () => {
    const { pager, requests } = manualPager(page(true, 'c', 'b'))
    const stale = pager.loadNewest()
    const fresh = pager.loadNewest()
    requests[1]?.answer(page(true, 'g', 'f'))
    expect(await fresh).toBe(2)

    requests[0]?.answer(page(true, 'd', 'c'))
    expect(await stale).toBe(0)
    expect(ids(pager.notes.value)).toEqual(['g', 'f'])
    expect(pager.hasMore.value).toBe(true)
    expect(pager.loadedUntil.value).toBe('c')
  })

  test('a failed request leaves it alone', async () => {
    const pager = useNotePager(
      async () => ({ error: { code: 'NOT_FOUND' } }),
      page(true, 'b', 'a'),
    )
    pager.notes.value = [note('c'), ...pager.notes.value]
    await pager.loadNewest()
    expect(pager.loadedUntil.value).toBe('b')
  })
})
