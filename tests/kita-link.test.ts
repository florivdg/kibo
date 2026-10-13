import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { notes } from '@/actions/notes'
import { db } from '@/db'
import { kitaLink } from '@/db/schema'
import { kitaLinkOf } from '@/lib/board/kita-link'
import { renewKitaLink } from '@/lib/board/mutations'
import {
  findBoardPage,
  findKita,
  findLinkedBoard,
  findPublicBoard,
  findPublicKita,
} from '@/lib/board/queries'
import { isKitaPath, withKitaSlash } from '@/lib/board/paths'
import { newLinkToken } from '@/lib/board/secrets'
import { addDays } from '@/lib/board/time'
import { GET as manifest } from '@/pages/k/[kita]/manifest.webmanifest'

import { refusal, visitorContext } from './helpers/actions'
import {
  insertTestNote,
  kitaTokenOf,
  newTestBoard,
  newTestKita,
  removeTestKitas,
} from './helpers/fixtures'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// The Kita link /k/<token>/ (src/lib/board/kita-link.ts): one secret for every
// board of a Kita, what the Kita page and the board pages read through it,
// its manifest and what renewing it does. Against the local PostgreSQL.

const now = new Date('2026-05-04T10:00:00.000Z')
const kitas: string[] = []

async function newKita() {
  const id = await newTestKita()
  kitas.push(id)
  return id
}

async function manifestFor(kita: string) {
  return manifest({
    params: { kita },
  } as unknown as Parameters<typeof manifest>[0])
}

beforeAll(resetSpamCounters)

afterAll(() => removeTestKitas(...kitas))

describe('kitaLinkOf', () => {
  test('makes the link once, for a Kita that has none yet', async () => {
    const id = await newKita()
    await testDb.delete(kitaLink).where(eq(kitaLink.organizationId, id))
    // Parallel first reads all get the one that won
    const tokens = await Promise.all(
      Array.from({ length: 5 }, async () => (await kitaLinkOf(id)).token),
    )
    expect(new Set(tokens).size).toBe(1)
    expect(tokens[0]).toMatch(/^[\w-]{22}$/)
    expect(await kitaLinkOf(id)).toEqual({
      token: tokens[0]!,
      name: 'Test-Kita',
    })
  })

  test('every Kita has a link of its own', async () => {
    const [first, second] = [await newKita(), await newKita()]
    expect(await kitaTokenOf(first)).not.toBe(await kitaTokenOf(second))
  })
})

describe('the Kita page', () => {
  test('lists every board with what its card shows, and nothing more', async () => {
    const id = await newKita()
    const empty = await newTestBoard(id, {
      name: 'Fundkiste',
      description: 'Was liegen blieb',
      pushEnabled: false,
    })
    const busy = await newTestBoard(id, { name: 'Pinnwand' })
    await insertTestNote(busy.id, { createdAt: addDays(now, -3) })
    await insertTestNote(busy.id, { createdAt: addDays(now, -1) })
    // Expired: neither counted nor news
    await insertTestNote(empty.id, { createdAt: addDays(now, -20) })
    // Another Kita's board is not on the page
    const elsewhere = await newTestBoard(await newKita())

    const found = await findPublicKita(empty.kitaToken, now)
    expect(found).toEqual({
      paused: false,
      // Self-hosted: the operator answers for the boards
      responsible: undefined,
      kita: {
        token: empty.kitaToken,
        name: 'Test-Kita',
        pushPublicKey: expect.any(String),
      },
      boards: [
        {
          id: empty.id,
          name: 'Fundkiste',
          description: 'Was liegen blieb',
          pushEnabled: false,
          noteCount: 0,
          latestNoteAt: null,
        },
        {
          id: busy.id,
          name: 'Pinnwand',
          description: '',
          pushEnabled: true,
          noteCount: 2,
          latestNoteAt: addDays(now, -1).toISOString(),
        },
      ],
    })
    expect(JSON.stringify(found)).not.toContain(elsewhere.id)
  })

  test('offers no notifications when no board takes them', async () => {
    const id = await newKita()
    const { kitaToken } = await newTestBoard(id, { pushEnabled: false })
    await newTestBoard(id, { pushEnabled: false })
    expect(await findPublicKita(kitaToken, now)).toMatchObject({
      paused: false,
      kita: { pushPublicKey: null },
    })
    await newTestBoard(id)
    expect(await findPublicKita(kitaToken, now)).toMatchObject({
      kita: { pushPublicKey: expect.any(String) },
    })
  })

  test('a link that leads nowhere finds nothing', async () => {
    expect(await findPublicKita(newLinkToken(), now)).toBeUndefined()
    expect(await findPublicKita('kaputt', now)).toBeUndefined()
  })
})

describe('a board through the Kita link', () => {
  test('is found with the link it was opened through', async () => {
    const { id, kitaToken, link } = await newTestBoard(await newKita())
    expect(await findPublicBoard(link, now)).toMatchObject({
      paused: false,
      board: { id, kitaToken, name: 'Igelgruppe' },
    })
    expect(await findLinkedBoard(link, now)).toMatchObject({
      id,
      paused: false,
    })
  })

  test('a board of another Kita answers like an unknown one', async () => {
    const { link } = await newTestBoard(await newKita())
    const foreign = await newTestBoard(await newKita())
    for (const boardId of [foreign.id, 'gibt-es-nicht']) {
      expect(await findPublicBoard({ ...link, boardId }, now)).toBeUndefined()
      expect(await findLinkedBoard({ ...link, boardId }, now)).toBeUndefined()
    }
    expect(
      await refusal(
        notes.list.orThrow.call(visitorContext('192.0.2.200'), {
          ...link,
          boardId: foreign.id,
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})

describe('the board page', () => {
  test('shows the board', async () => {
    const { id, link } = await newTestBoard(await newKita())
    expect(await findBoardPage(link, now)).toMatchObject({
      kind: 'board',
      board: { id },
    })
  })

  // The link works, only the board doesn't: the page leads to the others
  test('names the Kita for a board it does not have (any more)', async () => {
    const { link } = await newTestBoard(await newKita())
    const foreign = await newTestBoard(await newKita())
    for (const boardId of [foreign.id, 'gibt-es-nicht']) {
      expect(await findBoardPage({ ...link, boardId }, now)).toEqual({
        kind: 'unknown-board',
        kita: { name: 'Test-Kita' },
        responsible: undefined,
      })
    }
  })

  test('finds nothing for a link that leads nowhere', async () => {
    const { id } = await newTestBoard(await newKita())
    for (const kitaToken of [newLinkToken(), 'kaputt']) {
      expect(
        await findBoardPage({ kitaToken, boardId: id }, now),
      ).toBeUndefined()
    }
  })
})

describe('a malformed token', () => {
  // A token newLinkToken can't have made is no Kita: nobody asks the
  // database about it
  let select: ReturnType<typeof spyOn>

  afterEach(() => {
    select.mockRestore()
  })

  test('never reaches the database', async () => {
    const { id } = await newTestBoard(await newKita())
    select = spyOn(db, 'select')
    for (const kitaToken of ['kaputt', 'x'.repeat(23), 'a/b'.padEnd(22, 'c')]) {
      expect(await findKita(kitaToken, now)).toBeUndefined()
      expect(await findPublicKita(kitaToken, now)).toBeUndefined()
      const link = { kitaToken, boardId: id }
      expect(await findPublicBoard(link, now)).toBeUndefined()
      expect(await findLinkedBoard(link, now)).toBeUndefined()
      expect((await manifestFor(kitaToken)).status).toBe(404)
    }
    expect(select).not.toHaveBeenCalled()
  })
})

describe('the manifest', () => {
  test('makes the Kita one app, named after it and started on its page', async () => {
    const { kitaToken } = await newTestBoard(await newKita())
    const response = await manifestFor(kitaToken)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/manifest+json',
    )
    const path = `/k/${kitaToken}/`
    expect(await response.json()).toMatchObject({
      id: path,
      start_url: path,
      scope: path,
      name: 'Test-Kita',
      display: 'standalone',
    })
  })

  test('answers 404 for a link that leads nowhere', async () => {
    expect((await manifestFor(newLinkToken())).status).toBe(404)
  })
})

describe('renewing the Kita link', () => {
  test('locks the old link out of the Kita, its boards and its manifest; the notes stay', async () => {
    const id = await newKita()
    const { id: boardId, kitaToken: old } = await newTestBoard(id)
    const noteId = await insertTestNote(boardId, { createdAt: now })

    await renewKitaLink(id)
    const renewed = await kitaTokenOf(id)
    expect(renewed).not.toBe(old)

    expect(await findKita(old, now)).toBeUndefined()
    expect(await findPublicKita(old, now)).toBeUndefined()
    expect(
      await findPublicBoard({ kitaToken: old, boardId }, now),
    ).toBeUndefined()
    expect((await manifestFor(old)).status).toBe(404)

    const found = await findPublicBoard({ kitaToken: renewed, boardId }, now)
    expect(found?.paused === false && found.notes.map((n) => n.id)).toEqual([
      noteId,
    ])
    expect((await manifestFor(renewed)).status).toBe(200)
  })

  test('leaves the other Kitas alone', async () => {
    const [renewing, other] = [await newKita(), await newKita()]
    const before = await kitaTokenOf(other)
    await renewKitaLink(renewing)
    expect(await kitaTokenOf(other)).toBe(before)
  })
})

describe('the addresses of a Kita link', () => {
  const token = 'abcdefghijklmnopqrstuv'
  const slash = (path: string) =>
    withKitaSlash(new URL(path, 'https://kibo.example'))

  test('get their trailing slash, the query kept', () => {
    expect(slash(`/k/${token}`)).toBe(`/k/${token}/`)
    expect(slash(`/k/${token}/board-id?x=1`)).toBe(`/k/${token}/board-id/?x=1`)
  })

  test('are left alone with one, and so are files and everything else', () => {
    expect(slash(`/k/${token}/`)).toBeNull()
    expect(slash(`/k/${token}/manifest.webmanifest`)).toBeNull()
    expect(slash('/kontakt')).toBeNull()
    expect(slash('/b/abc')).toBeNull()
  })

  test('are told apart from every other address', () => {
    for (const path of ['/k', `/k/${token}/x/`]) {
      expect(isKitaPath(path)).toBe(true)
    }
    for (const path of [
      '/',
      '/kontakt',
      '/kita',
      '/bretter',
      '/admin',
      '/b/abc',
    ]) {
      expect(isKitaPath(path)).toBe(false)
    }
  })
})
