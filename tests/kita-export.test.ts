import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { APIContext } from 'astro'

import {
  KITA_EXPORT_FORMAT,
  KITA_EXPORT_VERSION,
  kitaExport,
  kitaExportFilename,
  type KitaExport,
} from '@/lib/board/kita-export'
import {
  attachmentFilename,
  exportRefusal,
} from '@/lib/board/kita-export-client'
import { addDays } from '@/lib/board/time'
import { instanceMode } from '@/lib/instance'
import {
  KITA_EXPORT_ACCOUNT_BUDGETS,
  KITA_EXPORT_KITA_BUDGETS,
} from '@/lib/spam/budgets'
import { GET } from '@/pages/admin/kita/export'

import {
  addTestMember,
  insertTestNote,
  kitaTokenOf,
  newOwnedKita,
  newTestBoard,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
  setTestSubscription,
} from './helpers/fixtures'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// The data export of a Kita (src/lib/board/kita-export.ts) and the download
// under /admin/kita/export, called the way Astro calls it once the
// middleware has put the session and the active Kita into locals

let kita: { organizationId: string; ownerId: string }
let other: { organizationId: string; ownerId: string }
let adminId: string
let strangerId: string
let boardId: string
let currentNoteId: string
let expiredNoteId: string
let otherNoteId: string

const hourly = KITA_EXPORT_ACCOUNT_BUDGETS.find(
  (budget) => budget.name === 'export:account-hour',
)!
const kitaDay = KITA_EXPORT_KITA_BUDGETS[0]!

function download(
  userId: string,
  organizationId: string,
  headers: Record<string, string> = {},
) {
  const context = {
    locals: { user: { id: userId }, organizationId },
    request: new Request('http://localhost/admin/kita/export', { headers }),
  } as unknown as APIContext
  return GET(context)
}

async function downloaded(userId: string, organizationId: string) {
  const response = await download(userId, organizationId)
  expect(response.status).toBe(200)
  return (await response.json()) as KitaExport
}

beforeAll(async () => {
  const first = await newOwnedKita()
  const second = await newOwnedKita()
  kita = { organizationId: first.organizationId, ownerId: first.owner.id }
  other = { organizationId: second.organizationId, ownerId: second.owner.id }

  const admin = await newTestUser()
  adminId = admin.id
  await addTestMember(kita.organizationId, adminId, 'admin')
  strangerId = (await newTestUser()).id

  const now = new Date()
  const target = await newTestBoard(kita.organizationId, {
    type: 'fundkiste',
    name: 'Fundkiste Igel',
    description: 'Alles aus der Igelgruppe',
    pushEnabled: false,
  })
  boardId = target.id
  currentNoteId = await insertTestNote(boardId, {
    categoryId: 'gefunden',
    title: 'Blaue Mütze',
    body: 'Lag im Garten',
    author: 'Anna',
    contact: '0170 123456',
  })
  expiredNoteId = await insertTestNote(boardId, {
    title: 'Längst weg',
    createdAt: addDays(now, -20),
    expiresAt: addDays(now, -6),
  })
  // A second, empty board: it is exported all the same
  await newTestBoard(kita.organizationId, { name: 'Pinnwand' })

  const foreign = await newTestBoard(other.organizationId, {
    name: 'Fremdes Brett',
  })
  otherNoteId = await insertTestNote(foreign.id, { title: 'Fremder Zettel' })
})

beforeEach(async () => {
  await resetSpamCounters()
})

afterEach(() => {
  instanceMode.hosted = false
})

afterAll(async () => {
  await removeTestKitas(kita.organizationId, other.organizationId)
  await removeTestUsers(kita.ownerId, other.ownerId, adminId, strangerId)
})

describe('the export document', () => {
  test('names its format and version, the Kita and every board in order', async () => {
    const now = new Date()
    const document = (await kitaExport(kita.organizationId, now, testDb))!
    expect(document.format).toBe(KITA_EXPORT_FORMAT)
    expect(document.version).toBe(KITA_EXPORT_VERSION)
    expect(document.exportedAt).toBe(now.toISOString())
    expect(document.kita).toEqual({ name: 'Test-Kita' })
    expect(document.boards.map((board) => board.name)).toEqual([
      'Fundkiste Igel',
      'Pinnwand',
    ])
    const [fundkiste, pinnwand] = document.boards
    expect(fundkiste).toMatchObject({
      id: boardId,
      type: 'fundkiste',
      typeLabel: 'Fundkiste',
      categories: [
        { id: 'gesucht', label: 'Gesucht' },
        { id: 'gefunden', label: 'Gefunden' },
      ],
      description: 'Alles aus der Igelgruppe',
      pushEnabled: false,
    })
    expect(pinnwand!.notes).toEqual([])
  })

  test('holds the current notes with their times, and not the expired one', async () => {
    const document = (await kitaExport(kita.organizationId, new Date()))!
    const notes = document.boards[0]!.notes
    expect(notes.map((note) => note.id)).toEqual([currentNoteId])
    expect(notes[0]).toEqual({
      id: currentNoteId,
      categoryId: 'gefunden',
      title: 'Blaue Mütze',
      body: 'Lag im Garten',
      author: 'Anna',
      contact: '0170 123456',
      createdAt: expect.any(String),
      expiresAt: expect.any(String),
    })
    expect(Date.parse(notes[0]!.expiresAt)).toBeGreaterThan(
      Date.parse(notes[0]!.createdAt),
    )
    expect(JSON.stringify(document)).not.toContain(expiredNoteId)
  })

  test('carries no secrets: neither the Kita link nor delete keys', async () => {
    const text = JSON.stringify(
      await kitaExport(kita.organizationId, new Date()),
    )
    expect(text).not.toContain(await kitaTokenOf(kita.organizationId))
    expect(text).not.toContain('deleteKeyHash')
    expect(text).not.toContain(kita.organizationId)
  })

  test('is nothing for a Kita that does not exist', async () => {
    expect(await kitaExport('test-no-such-kita', new Date())).toBeUndefined()
  })

  test('is saved under the Kita’s name and the day in Berlin', () => {
    // 23:30 UTC is already the next day in Berlin
    const late = new Date('2026-10-05T23:30:00Z')
    expect(kitaExportFilename('Kita Sonnenschein', late)).toBe(
      'kibo-kita-sonnenschein-2026-10-06.json',
    )
    expect(kitaExportFilename('Bärenhöhle', late)).toBe(
      'kibo-baerenhoehle-2026-10-06.json',
    )
    expect(kitaExportFilename('🌞', late)).toBe('kibo-kita-2026-10-06.json')
  })
})

describe('/admin/kita/export', () => {
  test('hands the owner the active Kita as a JSON attachment', async () => {
    const response = await download(kita.ownerId, kita.organizationId)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    const disposition = response.headers.get('content-disposition')
    expect(disposition).toMatch(
      /^attachment; filename="kibo-test-kita-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    expect(attachmentFilename(disposition)).toMatch(/^kibo-test-kita-/)
    const document = (await response.json()) as KitaExport
    expect(document.boards).toHaveLength(2)
  })

  test('hands an invited admin the same', async () => {
    const document = await downloaded(adminId, kita.organizationId)
    expect(document.boards.map((board) => board.id)).toContain(boardId)
  })

  test('never mixes in another Kita', async () => {
    const mine = JSON.stringify(
      await downloaded(kita.ownerId, kita.organizationId),
    )
    expect(mine).not.toContain(otherNoteId)
    expect(mine).not.toContain('Fremdes Brett')

    const theirs = await downloaded(other.ownerId, other.organizationId)
    expect(theirs.boards.map((board) => board.name)).toEqual(['Fremdes Brett'])
    expect(JSON.stringify(theirs)).not.toContain(currentNoteId)
  })

  test('refuses anyone who is no member of the Kita', async () => {
    for (const userId of [strangerId, other.ownerId]) {
      const response = await download(userId, kita.organizationId)
      expect(response.status).toBe(404)
      const text = await response.text()
      expect(text).not.toContain('Blaue Mütze')
      expect(text).not.toContain('Fundkiste Igel')
    }
  })

  test('still exports a Kita the hosted instance has paused', async () => {
    instanceMode.hosted = true
    for (const state of ['paused', 'deletable'] as const) {
      await setTestSubscription(kita.ownerId, state)
      const document = await downloaded(adminId, kita.organizationId)
      expect(document.boards[0]!.notes.map((note) => note.id)).toEqual([
        currentNoteId,
      ])
    }
  })

  test('counts downloads per account and answers 429 with the wait', async () => {
    for (let i = 0; i < hourly.max; i += 1) {
      expect((await download(kita.ownerId, kita.organizationId)).status).toBe(
        200,
      )
    }
    const refused = await download(kita.ownerId, kita.organizationId)
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await exportRefusal(refused)).toMatch(
      /^Bitte versuchen Sie es in .+ noch einmal\.$/,
    )
    // Another member of the Kita still gets theirs
    expect((await download(adminId, kita.organizationId)).status).toBe(200)
  })

  test('refused attempts of one account leave the Kita’s budget to the others', async () => {
    for (let i = 0; i < hourly.max; i += 1) {
      expect((await download(kita.ownerId, kita.organizationId)).status).toBe(
        200,
      )
    }
    // Far more refused attempts than the Kita's day allows in total
    for (let i = 0; i < kitaDay.max; i += 1) {
      expect((await download(kita.ownerId, kita.organizationId)).status).toBe(
        429,
      )
    }
    expect((await download(adminId, kita.organizationId)).status).toBe(200)
  })

  test('answers 429 once the Kita’s day is used up across its members', async () => {
    const saved = kitaDay.max
    kitaDay.max = 3
    try {
      for (const userId of [kita.ownerId, adminId, kita.ownerId]) {
        expect((await download(userId, kita.organizationId)).status).toBe(200)
      }
      for (const userId of [adminId, kita.ownerId]) {
        const refused = await download(userId, kita.organizationId)
        expect(refused.status).toBe(429)
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
      }
      // Another Kita has a day of its own
      expect((await download(other.ownerId, other.organizationId)).status).toBe(
        200,
      )
    } finally {
      kitaDay.max = saved
    }
  })

  test('turns a cross-site request away without spending budget', async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const refused = await download(kita.ownerId, kita.organizationId, {
        'sec-fetch-site': site,
      })
      expect(refused.status).toBe(403)
      expect(await refused.text()).not.toContain('Fundkiste Igel')
    }
    // The whole hour is still there, from the page itself
    for (let i = 0; i < hourly.max; i += 1) {
      const response = await download(kita.ownerId, kita.organizationId, {
        'sec-fetch-site': 'same-origin',
      })
      expect(response.status).toBe(200)
    }
  })
})
