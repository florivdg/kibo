import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { boards } from '@/actions/boards'
import { notes } from '@/actions/notes'
import { push } from '@/actions/push'
import { board, note } from '@/db/schema'
import { hashDeleteKey, newLinkToken } from '@/lib/board/secrets'
import type { BoardLink } from '@/lib/board/types'
import {
  HOSTED_PAUSED_ADMIN,
  HOSTED_PAUSED_VISITOR,
} from '@/lib/hosted/messages'
import type { SubscriptionState } from '@/lib/hosted/state'
import { instanceMode } from '@/lib/instance'
import { pushDispatcher } from '@/lib/push/dispatcher'

import { adminContext, refusal, visitorContext } from './helpers/actions'
import {
  insertTestNote,
  kitaTokenOf,
  newOwnedKita,
  newTestBoard,
  removeTestKitas,
  removeTestUsers,
  setTestSubscription,
  subscribersOf,
  subscriptionOf,
} from './helpers/fixtures'
import { noteDraft } from './helpers/note-draft'
import { newBrowser, type Browser } from './helpers/push'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// The actions themselves (src/actions/), run the way Astro runs them on the
// server (tests/helpers/astro-actions.ts), for a Kita whose owner's
// subscription on the hosted instance is in one state or another — and for
// the same Kita on an instance that isn't hosted.

// What a paused Kita answers, to its admins and to the visitors of its boards
const PAUSED_ADMIN = {
  code: 'PAYMENT_REQUIRED',
  status: 402,
  message: HOSTED_PAUSED_ADMIN,
}
const PAUSED_VISITOR = { ...PAUSED_ADMIN, message: HOSTED_PAUSED_VISITOR }

// Everything keeps working up to the end of the grace period
const WORKING: SubscriptionState[] = ['trial', 'active', 'grace']
const PAUSED: SubscriptionState[] = ['paused', 'deletable']

const DELETE_KEY = 'ein-schluessel-nur-fuer-diesen-test'

let organizationId: string
let ownerId: string
let browser: Browser
let visitors = 0

// The Kita as the hosted instance sees it in the given state; `hosted: false`
// is the same data on an instance somebody runs for themselves
async function kitaIs(state: SubscriptionState, hosted = true) {
  await setTestSubscription(ownerId, state)
  instanceMode.hosted = hosted
}

// Every request from a network of its own, so no budget is in the way
function visitor() {
  visitors += 1
  return visitorContext(`192.0.2.${visitors}`)
}

const admin = () => adminContext(organizationId)

async function boardRow(id: string) {
  const [row] = await testDb.select().from(board).where(eq(board.id, id))
  return row
}

async function notesOf(boardId: string) {
  const rows = await testDb
    .select({ id: note.id })
    .from(note)
    .where(eq(note.boardId, boardId))
  return rows.map((row) => row.id)
}

function subscription(link: BoardLink, name: string) {
  return {
    ...link,
    endpoint: `https://fcm.googleapis.com/fcm/send/hosted-${name}`,
    keys: { p256dh: browser.p256dh, auth: browser.auth },
  }
}

// The page's sync, for the browser `name` of subscription()
function syncOf({ kitaToken }: BoardLink, name: string) {
  const { endpoint, keys } = subscription({ kitaToken, boardId: '' }, name)
  return { kitaToken, endpoint, keys }
}

const currentKitaToken = () => kitaTokenOf(organizationId)

beforeAll(async () => {
  browser = await newBrowser()
  const kita = await newOwnedKita()
  organizationId = kita.organizationId
  ownerId = kita.owner.id
})

beforeEach(async () => {
  visitors = 0
  await resetSpamCounters()
})

afterEach(() => {
  instanceMode.hosted = false
})

afterAll(async () => {
  await removeTestKitas(organizationId)
  await removeTestUsers(ownerId)
})

describe('boards.* of a paused Kita', () => {
  test('every change to a board is refused with 402, and nothing changes', async () => {
    for (const state of PAUSED) {
      const target = await newTestBoard(organizationId)
      const noteId = await insertTestNote(target.id)
      const before = await boardRow(target.id)
      const linkBefore = await currentKitaToken()
      await kitaIs(state)

      const { id } = target
      // One after the other, the way an admin would click through them
      const attempts = {
        create: () =>
          boards.create.orThrow.call(admin(), {
            type: 'pinnwand',
            name: 'Neues Brett',
            description: '',
          }),
        update: () =>
          boards.update.orThrow.call(admin(), {
            id,
            name: 'Umbenannt',
            description: 'Neu',
          }),
        renewKitaLink: () =>
          boards.renewKitaLink.orThrow.call(admin(), undefined),
        setPushEnabled: () =>
          boards.setPushEnabled.orThrow.call(admin(), { id, enabled: false }),
        remove: () => boards.remove.orThrow.call(admin(), { id }),
      }
      for (const [name, attempt] of Object.entries(attempts)) {
        expect([name, await refusal(attempt())]).toEqual([name, PAUSED_ADMIN])
      }

      expect(await boardRow(id)).toEqual(before)
      expect(await currentKitaToken()).toBe(linkBefore)
      expect(await notesOf(id)).toEqual([noteId])
      const names = await testDb
        .select({ name: board.name })
        .from(board)
        .where(eq(board.organizationId, organizationId))
      expect(names.map((row) => row.name)).not.toContain('Neues Brett')
    }
  })

  test('its admins still read the notes', async () => {
    const target = await newTestBoard(organizationId)
    const noteId = await insertTestNote(target.id, { title: 'Bleibt lesbar' })
    await kitaIs('paused')

    const page = await boards.listNotes.orThrow.call(admin(), { id: target.id })
    expect(page.hasMore).toBe(false)
    expect(page.notes.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: noteId, title: 'Bleibt lesbar' },
    ])
  })

  // A note with somebody's contact details has to be removable at any time
  test('its admins still take a note down', async () => {
    for (const state of PAUSED) {
      const target = await newTestBoard(organizationId)
      const stays = await insertTestNote(target.id)
      const goes = await insertTestNote(target.id, {
        contact: 'anna@example.org',
      })
      await kitaIs(state)

      await boards.removeNote.orThrow.call(admin(), { noteId: goes })
      expect(await notesOf(target.id)).toEqual([stays])
    }
  })

  test('only the notes of its own boards, as ever', async () => {
    const other = await newOwnedKita()
    try {
      const foreign = await newTestBoard(other.organizationId)
      const noteId = await insertTestNote(foreign.id)
      await kitaIs('paused')
      expect(
        await refusal(boards.removeNote.orThrow.call(admin(), { noteId })),
      ).toMatchObject({ code: 'NOT_FOUND' })
      expect(await notesOf(foreign.id)).toEqual([noteId])
    } finally {
      await removeTestKitas(other.organizationId)
      await removeTestUsers(other.owner.id)
    }
  })

  // Who may act at all is settled first, as ever
  test('a request without a session or a Kita is turned away as before', async () => {
    await kitaIs('paused')
    const input = { type: 'pinnwand' as const, name: 'Brett', description: '' }
    const noSession = { locals: {} } as unknown as ReturnType<typeof admin>
    const noKita = {
      locals: { user: { id: 'test-user' } },
    } as unknown as ReturnType<typeof admin>
    expect(
      await refusal(boards.create.orThrow.call(noSession, input)),
    ).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(
      await refusal(boards.create.orThrow.call(noKita, input)),
    ).toMatchObject({ code: 'FORBIDDEN' })
  })
})

// One board through everything an admin does with it
async function manageBoard() {
  const { id } = await boards.create.orThrow.call(admin(), {
    type: 'pinnwand',
    name: 'Igelgruppe',
    description: '',
  })
  const noteId = await insertTestNote(id)
  const linkBefore = await currentKitaToken()

  await boards.update.orThrow.call(admin(), {
    id,
    name: 'Igel',
    description: 'Für die Igel',
  })
  await boards.setPushEnabled.orThrow.call(admin(), { id, enabled: false })
  await boards.renewKitaLink.orThrow.call(admin(), undefined)
  expect(await boardRow(id)).toMatchObject({
    name: 'Igel',
    description: 'Für die Igel',
    pushEnabled: false,
  })
  expect(await currentKitaToken()).not.toBe(linkBefore)

  const page = await boards.listNotes.orThrow.call(admin(), { id })
  expect(page.notes.map((entry) => entry.id)).toEqual([noteId])
  await boards.removeNote.orThrow.call(admin(), { noteId })
  expect(await notesOf(id)).toEqual([])

  await boards.remove.orThrow.call(admin(), { id })
  expect(await boardRow(id)).toBeUndefined()
}

describe('boards.* otherwise', () => {
  test('work in the trial, with a paid subscription and in the grace period', async () => {
    for (const state of WORKING) {
      await kitaIs(state)
      await manageBoard()
    }
  })

  test('work without HOSTED, whatever a subscription says', async () => {
    for (const state of PAUSED) {
      await kitaIs(state, false)
      await manageBoard()
    }
  })

  test('ask for no subscription on an instance that is not hosted', async () => {
    const kita = await newOwnedKita()
    try {
      await boards.create.orThrow.call(adminContext(kita.organizationId), {
        type: 'fundkiste',
        name: 'Fundkiste',
        description: '',
      })
      expect(await subscriptionOf(kita.owner.id)).toBeUndefined()
    } finally {
      await removeTestKitas(kita.organizationId)
      await removeTestUsers(kita.owner.id)
    }
  })
})

describe('notes.* on a board of a paused Kita', () => {
  test('nothing is pinned or listed: 402 with a sentence for parents', async () => {
    for (const state of PAUSED) {
      const target = await newTestBoard(organizationId)
      const noteId = await insertTestNote(target.id, {
        deleteKeyHash: hashDeleteKey(DELETE_KEY),
      })
      await kitaIs(state)

      const { link } = target
      expect(
        await refusal(
          notes.create.orThrow.call(visitor(), await noteDraft(link)),
        ),
      ).toEqual(PAUSED_VISITOR)
      expect(await refusal(notes.list.orThrow.call(visitor(), link))).toEqual(
        PAUSED_VISITOR,
      )
      expect(
        await refusal(notes.formToken.orThrow.call(visitor(), link)),
      ).toEqual(PAUSED_VISITOR)

      // The note that was there stays, until it expires like any other
      expect(await notesOf(target.id)).toEqual([noteId])
    }
  })

  // The paused page shows no notes, but a page that was open before does, and
  // what somebody pinned with their contact details is theirs to remove
  test('a visitor still takes their own note down, with its key', async () => {
    for (const state of PAUSED) {
      const target = await newTestBoard(organizationId)
      const { link } = target
      const stays = await insertTestNote(target.id)
      const own = await insertTestNote(target.id, {
        contact: 'anna@example.org',
        deleteKeyHash: hashDeleteKey(DELETE_KEY),
      })
      await kitaIs(state)

      // Not with the wrong key, and not somebody else's note
      for (const attempt of [
        { ...link, noteId: own, deleteKey: 'falscher-schluessel' },
        { ...link, noteId: stays, deleteKey: DELETE_KEY },
      ]) {
        expect(
          await refusal(notes.remove.orThrow.call(visitor(), attempt)),
        ).toMatchObject({ code: 'NOT_FOUND' })
      }
      expect(await notesOf(target.id)).toHaveLength(2)

      await notes.remove.orThrow.call(visitor(), {
        ...link,
        noteId: own,
        deleteKey: DELETE_KEY,
      })
      expect(await notesOf(target.id)).toEqual([stays])
    }
  })

  test('a link that leads nowhere is still just that', async () => {
    const { link } = await newTestBoard(organizationId)
    await kitaIs('paused')
    for (const kitaToken of ['unbekannt', 'x'.repeat(43), newLinkToken()]) {
      expect(
        await refusal(
          notes.list.orThrow.call(visitor(), { ...link, kitaToken }),
        ),
      ).toMatchObject({ code: 'NOT_FOUND', status: 404 })
    }
  })
})

// One note through everything a visitor does with it
async function pinAndTakeDown(title: string) {
  const target = await newTestBoard(organizationId)
  const { link } = target
  const created = await notes.create.orThrow.call(
    visitor(),
    await noteDraft(link, { title }),
  )
  // The notification the note scheduled is none of this test's business
  pushDispatcher.cancel(target.id)
  expect(created.note.title).toBe(title)

  const page = await notes.list.orThrow.call(visitor(), link)
  expect(page.notes.map((entry) => entry.id)).toEqual([created.note.id])

  await notes.remove.orThrow.call(visitor(), {
    ...link,
    noteId: created.note.id,
    deleteKey: created.deleteKey,
  })
  expect(await notesOf(target.id)).toEqual([])
}

describe('notes.* otherwise', () => {
  test('work in the trial, with a paid subscription and in the grace period', async () => {
    for (const state of WORKING) {
      await kitaIs(state)
      await pinAndTakeDown(`Zettel ${state}`)
    }
  })

  test('work without HOSTED, whatever a subscription says', async () => {
    for (const state of PAUSED) {
      await kitaIs(state, false)
      await pinAndTakeDown(`Zettel ${state}`)
    }
  })

  // The key is checked against the board the link leads to, as before
  test('a note is only taken down through its own board and key', async () => {
    await kitaIs('active')
    const target = await newTestBoard(organizationId)
    const other = await newTestBoard(organizationId)
    const noteId = await insertTestNote(target.id, {
      deleteKeyHash: hashDeleteKey(DELETE_KEY),
    })
    for (const attempt of [
      { ...other.link, noteId, deleteKey: DELETE_KEY },
      { ...target.link, noteId, deleteKey: 'falscher-schluessel' },
      // The Kita link of before a renewal, or one that never was
      {
        ...target.link,
        kitaToken: newLinkToken(),
        noteId,
        deleteKey: DELETE_KEY,
      },
      { ...target.link, kitaToken: 'kaputt', noteId, deleteKey: DELETE_KEY },
    ]) {
      expect(
        await refusal(notes.remove.orThrow.call(visitor(), attempt)),
      ).toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await notesOf(target.id)).toEqual([noteId])
  })
})

describe('push.* on a board of a paused Kita', () => {
  test('takes no subscription and refreshes none, but lets a browser go', async () => {
    const target = await newTestBoard(organizationId)
    const { link } = target
    await kitaIs('active')
    expect(
      await push.subscribe.orThrow.call(visitor(), subscription(link, 'a')),
    ).toEqual({ subscribed: true })

    for (const state of PAUSED) {
      await kitaIs(state)
      expect(
        await refusal(
          push.subscribe.orThrow.call(visitor(), subscription(link, 'b')),
        ),
      ).toEqual(PAUSED_VISITOR)
      // The page's sync of a subscription the board already has
      expect(
        await refusal(push.sync.orThrow.call(visitor(), syncOf(link, 'a'))),
      ).toEqual(PAUSED_VISITOR)
      expect(
        (await subscribersOf(target.id)).map((row) => row.endpoint),
      ).toEqual([subscription(link, 'a').endpoint])
    }

    // Unsubscribing only ever removes data
    expect(
      await push.unsubscribe.orThrow.call(visitor(), {
        ...link,
        endpoint: subscription(link, 'a').endpoint,
      }),
    ).toMatchObject({ subscribed: false, unseen: 0 })
    expect(await subscribersOf(target.id)).toEqual([])
  })

  test('the subscription that was there is back in use once the Kita is paid for', async () => {
    const target = await newTestBoard(organizationId)
    const { link } = target
    await kitaIs('active')
    await push.subscribe.orThrow.call(visitor(), subscription(link, 'a'))
    await kitaIs('paused')
    await kitaIs('active')
    const { boardIds } = await push.sync.orThrow.call(
      visitor(),
      syncOf(link, 'a'),
    )
    expect(boardIds).toContain(target.id)
  })
})

describe('push.* otherwise', () => {
  async function subscribeAndLeave() {
    const target = await newTestBoard(organizationId)
    const { link } = target
    expect(
      await push.subscribe.orThrow.call(visitor(), subscription(link, 'a')),
    ).toEqual({ subscribed: true })
    expect(await subscribersOf(target.id)).toHaveLength(1)
    const { boardIds } = await push.sync.orThrow.call(
      visitor(),
      syncOf(link, 'a'),
    )
    expect(boardIds).toContain(target.id)
    await push.unsubscribe.orThrow.call(visitor(), {
      ...link,
      endpoint: subscription(link, 'a').endpoint,
    })
    expect(await subscribersOf(target.id)).toEqual([])
  }

  test('work in the trial, with a paid subscription and in the grace period', async () => {
    for (const state of WORKING) {
      await kitaIs(state)
      await subscribeAndLeave()
    }
  })

  test('work without HOSTED, whatever a subscription says', async () => {
    for (const state of PAUSED) {
      await kitaIs(state, false)
      await subscribeAndLeave()
    }
  })
})
