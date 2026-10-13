import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq } from 'drizzle-orm'

import { kita } from '@/actions/kita'
import { kitaLink } from '@/db/schema'
import { privacyContactOf } from '@/lib/board/kita-link'
import { renewKitaLink } from '@/lib/board/mutations'
import {
  normalizePrivacyContact,
  PRIVACY_CONTACT_INVALID,
  privacyContactLink,
} from '@/lib/board/privacy-contact'
import {
  findBoardPage,
  findPublicBoard,
  findPublicKita,
} from '@/lib/board/queries'
import { instanceMode } from '@/lib/instance'

import { refusal, signedInContext } from './helpers/actions'
import {
  addTestMember,
  newOwnedKita,
  newTestBoard,
  newTestUser,
  removeTestKitas,
  removeTestUsers,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// Who answers for the boards of a Kita on the hosted instance: the Kita,
// named at the foot of every page of its link, with the privacy contact its
// owner set on /admin/kita (src/lib/board/privacy-contact.ts,
// src/actions/kita.ts). Against the local PostgreSQL.

const now = new Date()
const kitas: string[] = []
const users: string[] = []

async function ownedKita() {
  const { organizationId, owner } = await newOwnedKita()
  kitas.push(organizationId)
  users.push(owner.id)
  return { organizationId, owner }
}

function setContact(
  userId: string,
  organizationId: string | undefined,
  privacyContact: string,
) {
  return kita.setPrivacyContact.orThrow.call(
    signedInContext(userId, organizationId),
    { privacyContact },
  )
}

beforeEach(() => {
  instanceMode.hosted = true
})

afterEach(() => {
  instanceMode.hosted = false
})

afterAll(async () => {
  await removeTestKitas(...kitas)
  await removeTestUsers(...users)
})

describe('what counts as a privacy contact', () => {
  test('an e-mail address or an https:// link', () => {
    expect(normalizePrivacyContact('  datenschutz@traeger.example ')).toBe(
      'datenschutz@traeger.example',
    )
    expect(normalizePrivacyContact("o'connor+kita@kita-1.example.org")).toBe(
      "o'connor+kita@kita-1.example.org",
    )
    expect(normalizePrivacyContact('https://traeger.example/datenschutz')).toBe(
      'https://traeger.example/datenschutz',
    )
    // As the browser would read it
    expect(normalizePrivacyContact('HTTPS://Traeger.Example')).toBe(
      'https://traeger.example/',
    )
  })

  test('nothing is no contact', () => {
    expect(normalizePrivacyContact('')).toBeNull()
    expect(normalizePrivacyContact('   ')).toBeNull()
  })

  test('anything else is turned away', () => {
    for (const value of [
      'http://traeger.example/datenschutz',
      'javascript:alert(1)',
      'mailto:datenschutz@traeger.example',
      'ftp://traeger.example',
      'data:text/html,hallo',
      'https://user:pass@traeger.example/',
      'https://localhost/',
      'https://',
      'traeger.example',
      'datenschutz',
      'datenschutz@',
      'a@b',
      'a b@traeger.example',
      'a@traeger.example, b@traeger.example',
      'a@traeger.example?subject=x',
      'a@traeger.example\nBcc: b@traeger.example',
      'https://traeger.example/‮gnirts',
      '​',
      `https://traeger.example/${'x'.repeat(300)}`,
      `${'x'.repeat(250)}@traeger.example`,
    ]) {
      expect(normalizePrivacyContact(value)).toBeUndefined()
    }
  })

  test('shown as a link: mailto for an address, a page without its scheme', () => {
    expect(privacyContactLink('datenschutz@traeger.example')).toEqual({
      href: 'mailto:datenschutz@traeger.example',
      label: 'datenschutz@traeger.example',
    })
    expect(privacyContactLink('https://traeger.example/')).toEqual({
      href: 'https://traeger.example/',
      label: 'traeger.example',
    })
    expect(privacyContactLink('https://traeger.example/datenschutz')).toEqual({
      href: 'https://traeger.example/datenschutz',
      label: 'traeger.example/datenschutz',
    })
  })
})

describe('kita.setPrivacyContact', () => {
  test('the owner sets it, changes it and takes it away', async () => {
    const { organizationId, owner } = await ownedKita()
    expect(await privacyContactOf(organizationId)).toBeNull()

    expect(
      await setContact(owner.id, organizationId, ' datenschutz@kita.example '),
    ).toEqual({ privacyContact: 'datenschutz@kita.example' })
    expect(await privacyContactOf(organizationId)).toBe(
      'datenschutz@kita.example',
    )

    await setContact(owner.id, organizationId, 'https://kita.example/ds')
    expect(await privacyContactOf(organizationId)).toBe(
      'https://kita.example/ds',
    )

    await setContact(owner.id, organizationId, '')
    expect(await privacyContactOf(organizationId)).toBeNull()
  })

  // No admin page has read the link yet: it is made with the contact
  test('a Kita without a link gets one with it', async () => {
    const { organizationId, owner } = await ownedKita()
    await testDb
      .delete(kitaLink)
      .where(eq(kitaLink.organizationId, organizationId))

    await setContact(owner.id, organizationId, 'datenschutz@kita.example')
    const [row] = await testDb
      .select()
      .from(kitaLink)
      .where(eq(kitaLink.organizationId, organizationId))
    expect(row?.token).toMatch(/^[\w-]{22}$/)
    expect(row?.privacyContact).toBe('datenschutz@kita.example')
  })

  test('a new Kita link keeps it', async () => {
    const { organizationId, owner } = await ownedKita()
    await setContact(owner.id, organizationId, 'datenschutz@kita.example')
    await renewKitaLink(organizationId)
    expect(await privacyContactOf(organizationId)).toBe(
      'datenschutz@kita.example',
    )
  })

  test('what is no contact is refused with the sentence the form shows', async () => {
    const { organizationId, owner } = await ownedKita()
    await setContact(owner.id, organizationId, 'datenschutz@kita.example')
    for (const value of ['http://kita.example', 'javascript:alert(1)']) {
      expect(
        await refusal(setContact(owner.id, organizationId, value)),
      ).toEqual({
        code: 'BAD_REQUEST',
        status: 400,
        message: PRIVACY_CONTACT_INVALID,
      })
    }
    expect(await privacyContactOf(organizationId)).toBe(
      'datenschutz@kita.example',
    )
  })

  // Like renaming the Kita
  test('only the owner: an admin of the Kita gets 403', async () => {
    const { organizationId } = await ownedKita()
    const admin = await newTestUser()
    users.push(admin.id)
    await addTestMember(organizationId, admin.id, 'admin')

    expect(
      await refusal(setContact(admin.id, organizationId, 'a@kita.example')),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 })
    const stranger = await newTestUser()
    users.push(stranger.id)
    expect(
      await refusal(setContact(stranger.id, organizationId, 'a@kita.example')),
    ).toMatchObject({ code: 'FORBIDDEN' })
    expect(await privacyContactOf(organizationId)).toBeNull()
  })

  test('without a session: 401, without an active Kita: 403', async () => {
    const { owner } = await ownedKita()
    expect(
      await refusal(
        kita.setPrivacyContact.orThrow.call(
          { locals: {} } as unknown as ThisParameterType<
            typeof kita.setPrivacyContact.orThrow
          >,
          { privacyContact: '' },
        ),
      ),
    ).toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    expect(
      await refusal(setContact(owner.id, undefined, 'a@kita.example')),
    ).toMatchObject({ code: 'FORBIDDEN' })
  })

  // Self-hosted, the operator is usually the Träger: there is no such setting
  test('without HOSTED the action is not there: 404', async () => {
    const { organizationId, owner } = await ownedKita()
    instanceMode.hosted = false
    expect(
      await refusal(setContact(owner.id, organizationId, 'a@kita.example')),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(await privacyContactOf(organizationId)).toBeNull()
  })
})

describe('the pages of the Kita link', () => {
  test('name the Kita as responsible, with the contact once it is set', async () => {
    const { organizationId, owner } = await ownedKita()
    const { kitaToken, link } = await newTestBoard(organizationId)
    const named = { kitaName: 'Test-Kita', contact: undefined }
    expect(await findPublicKita(kitaToken, now)).toMatchObject({
      responsible: named,
    })
    expect(await findPublicBoard(link, now)).toMatchObject({
      responsible: named,
    })

    await setContact(owner.id, organizationId, 'datenschutz@kita.example')
    const responsible = {
      kitaName: 'Test-Kita',
      contact: {
        href: 'mailto:datenschutz@kita.example',
        label: 'datenschutz@kita.example',
      },
    }
    expect(await findPublicKita(kitaToken, now)).toMatchObject({ responsible })
    expect(await findBoardPage(link, now)).toMatchObject({
      kind: 'board',
      responsible,
    })
    // A board the Kita doesn't have: the page under a link that works
    expect(
      await findBoardPage({ ...link, boardId: 'gibt-es-nicht' }, now),
    ).toMatchObject({ kind: 'unknown-board', responsible })
  })

  test('say nothing about it on a self-hosted instance', async () => {
    const { organizationId, owner } = await ownedKita()
    const { kitaToken, link } = await newTestBoard(organizationId)
    await setContact(owner.id, organizationId, 'datenschutz@kita.example')
    instanceMode.hosted = false

    expect((await findPublicKita(kitaToken, now))?.responsible).toBeUndefined()
    expect((await findBoardPage(link, now))?.responsible).toBeUndefined()
  })
})
