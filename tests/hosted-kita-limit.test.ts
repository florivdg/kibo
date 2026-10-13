import { randomUUID } from 'node:crypto'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import { hostedSubscription, member, organization } from '@/db/schema'
import { addBerlinDays, addDays, dateAndTime } from '@/lib/board/time'
import { setPaidUntil } from '@/lib/hosted/subscriptions'
import { termsMails } from '@/lib/hosted/terms'
import { hostedContact, hostedPricing, instanceMode } from '@/lib/instance'
import { HOSTED_ORGANIZATION_CAP, ORGANIZATION_LIMIT } from '@/lib/limits'
import type { Mail } from '@/lib/mail/mailer'

import { answer, authRequests, type Account } from './helpers/auth'
import {
  addTestMember,
  newTestKita,
  setTestSubscription,
  subscriptionOf,
} from './helpers/fixtures'
import { testDb } from './helpers/spam-db'

// Creating a Kita on the hosted instance, as the handler runs it
// (checkKitaCreation, organizationLimit and afterCreateOrganization in
// src/lib/auth.ts): the account agrees to the terms before its first Kita,
// the trial starts with it and is for that one, a paid subscription takes
// more, and one that has run out takes none.
const kitas: string[] = []

// TEST-NET-1 is this file's network (tests/helpers/auth.ts)
const { newAccount, post, removeAccounts, resetRateLimit } = authRequests(
  '192.0.2.',
  'hosted-limit',
)

const OK = { status: 200, code: undefined }

// The form sends `acceptTerms: true` when the box is ticked, with the
// version its links showed — the current one; `terms` is what the request
// says about it instead
const UNTICKED = {}

function ticked() {
  return { acceptTerms: true, termsVersion: hostedContact.termsVersion }
}

async function createKita(
  owner: Account,
  terms: { acceptTerms?: unknown; termsVersion?: unknown } = ticked(),
) {
  const created = await post(
    '/organization/create',
    {
      name: 'Kita Sonnenschein',
      slug: `kita-${randomUUID().slice(0, 18)}`,
      ...terms,
    },
    owner.cookie,
  )
  if (created.status === 200) kitas.push(String(created.data?.id))
  return created
}

// Kitas the account owns, put there without the API: what is asked here is
// the next one
async function ownKitas(owner: Account, count: number) {
  for (let i = 0; i < count; i++) {
    const id = await newTestKita()
    kitas.push(id)
    await addTestMember(id, owner.id)
  }
}

async function ownedBy(owner: Account) {
  const rows = await testDb
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, owner.id))
  return rows.length
}

// The mails that confirm an agreement, instead of a mail server. They go out
// after the answer (src/lib/auth.ts), so a test waits for them — and one
// that doesn't may see them arrive in the next, so the real mailer only
// comes back after the last.
let termsSent: Mail[] = []
const realTermsSend = termsMails.send

async function termsMailsTo(email: string) {
  const deadline = Date.now() + 2000
  const to = () => termsSent.filter((mail) => mail.to === email)
  while (to().length === 0 && Date.now() < deadline) await Bun.sleep(10)
  return to()
}

beforeAll(resetRateLimit)

beforeEach(() => {
  instanceMode.hosted = true
  termsSent = []
  termsMails.send = async (mail) => {
    termsSent.push(mail)
  }
})

afterEach(() => {
  instanceMode.hosted = false
  hostedPricing.trialDays = 30
  hostedContact.termsVersion = '2026-10'
})

afterAll(async () => {
  termsMails.send = realTermsSend
  await testDb.delete(organization).where(inArray(organization.id, kitas))
  await removeAccounts()
  await resetRateLimit()
})

describe('the first Kita of an account', () => {
  test('starts the trial', async () => {
    hostedPricing.trialDays = 14
    const owner = await newAccount()
    expect(await subscriptionOf(owner.id)).toBeUndefined()

    const before = Date.now()
    expect(await answer(createKita(owner))).toEqual(OK)
    const after = Date.now()

    const row = await subscriptionOf(owner.id)
    expect(row).toMatchObject({
      paidUntil: null,
      complimentary: false,
      invoiceRequestedAt: null,
      reminderStage: 0,
    })
    const trialEndsAt = row!.trialEndsAt.getTime()
    expect(trialEndsAt).toBeGreaterThanOrEqual(
      addBerlinDays(new Date(before), 14).getTime(),
    )
    expect(trialEndsAt).toBeLessThanOrEqual(
      addBerlinDays(new Date(after), 14).getTime(),
    )
  })

  test('the trial is for that one Kita', async () => {
    const owner = await newAccount()
    expect(await answer(createKita(owner))).toEqual(OK)
    const { trialEndsAt } = (await subscriptionOf(owner.id))!

    const second = await createKita(owner)
    expect(second.status).toBe(403)
    expect(second.code).toBe('HOSTED_TRIAL_ONE_KITA')
    expect(second.data?.message).toBe(
      'In der Testphase lässt sich eine Kita anlegen. Weitere Kitas gibt es mit dem Abo.',
    )
    expect(await ownedBy(owner)).toBe(1)
    // Asking again doesn't start the trial over
    expect((await subscriptionOf(owner.id))?.trialEndsAt).toEqual(trialEndsAt)
  })

  test('an invitation is not a Kita of one’s own', async () => {
    const host = await newAccount()
    expect(await answer(createKita(host))).toEqual(OK)
    const guest = await newAccount()
    await addTestMember(kitas.at(-1)!, guest.id, 'admin')

    expect(await answer(createKita(guest))).toEqual(OK)
    expect(await subscriptionOf(guest.id)).toBeDefined()
  })
})

describe('the terms', () => {
  const REFUSED = { status: 400, code: 'TERMS_NOT_ACCEPTED' }

  test('without agreeing to them there is no first Kita, and no subscription', async () => {
    const owner = await newAccount()
    expect(await answer(createKita(owner, UNTICKED))).toEqual(REFUSED)
    for (const acceptTerms of [false, 'true', 1, null]) {
      expect(await answer(createKita(owner, { acceptTerms }))).toEqual(REFUSED)
    }
    expect(await ownedBy(owner)).toBe(0)
    expect(await subscriptionOf(owner.id)).toBeUndefined()
  })

  // A form left open while the terms changed: the box was ticked for texts
  // that are no longer the current ones
  test('an agreement to another version makes no Kita', async () => {
    hostedContact.termsVersion = '2027-01'
    const owner = await newAccount()
    for (const termsVersion of ['2026-10', undefined, '', 202701]) {
      expect(
        await answer(createKita(owner, { acceptTerms: true, termsVersion })),
      ).toEqual({ status: 400, code: 'TERMS_VERSION_CHANGED' })
    }
    expect(await ownedBy(owner)).toBe(0)
    expect(await subscriptionOf(owner.id)).toBeUndefined()
    await Bun.sleep(100)
    expect(termsSent.filter((sent) => sent.to === owner.email)).toEqual([])

    expect(await answer(createKita(owner))).toEqual(OK)
    expect((await subscriptionOf(owner.id))?.termsVersion).toBe('2027-01')
  })

  test('the subscription remembers the version agreed to, and when', async () => {
    hostedContact.termsVersion = '2027-01'
    const owner = await newAccount()
    const before = Date.now()
    expect(await answer(createKita(owner))).toEqual(OK)
    const after = Date.now()

    const row = (await subscriptionOf(owner.id))!
    expect(row.termsVersion).toBe('2027-01')
    const acceptedAt = row.termsAcceptedAt!.getTime()
    expect(acceptedAt).toBeGreaterThanOrEqual(before)
    expect(acceptedAt).toBeLessThanOrEqual(after)
  })

  // A record the account keeps: both parties, the version, the moment and
  // where both texts can be read in that version
  test('the account gets a mail that confirms the agreement', async () => {
    hostedContact.termsVersion = '2027-01'
    const owner = await newAccount()
    expect(await answer(createKita(owner))).toEqual(OK)
    const { termsAcceptedAt } = (await subscriptionOf(owner.id))!

    const [mail, ...more] = await termsMailsTo(owner.email)
    expect(more).toEqual([])
    expect(mail!.subject).toBe(
      'Ihre Zustimmung zu den AGB und zum AV-Vertrag von Kibo',
    )
    expect(mail!.text).toContain('Hallo Anna Beispiel,')
    expect(mail!.text).toContain(`Konto: Anna Beispiel (${owner.email})`)
    expect(mail!.text).toContain('Kita: Kita Sonnenschein')
    expect(mail!.text).toContain('Fassung: 2027-01')
    expect(mail!.text).toContain(
      `Zugestimmt am: ${dateAndTime(termsAcceptedAt!)} Uhr (deutsche Zeit)`,
    )
    expect(mail!.text).toContain('AGB: http://localhost:4321/agb/2027-01')
    expect(mail!.text).toContain(
      'AV-Vertrag: http://localhost:4321/avv/2027-01',
    )

    // A further Kita agrees to nothing, and says so to nobody
    await setPaidUntil(testDb, owner.id, addDays(new Date(), 365), new Date())
    expect(await answer(createKita(owner))).toEqual(OK)
    await Bun.sleep(100)
    expect(termsSent.filter((sent) => sent.to === owner.email)).toHaveLength(1)
  })

  // A refusal leaves nothing behind that a later Kita could pick up
  test('an agreement that came to nothing is not kept for later', async () => {
    const owner = await newAccount()
    await ownKitas(owner, 1)
    await setTestSubscription(owner.id, 'active')
    // Agreed, but this is not the first Kita: nothing to store …
    expect(await answer(createKita(owner))).toEqual(OK)
    expect((await subscriptionOf(owner.id))?.termsVersion).toBeNull()
    // … and a further one asks for nothing
    expect(await answer(createKita(owner, UNTICKED))).toEqual(OK)
    expect((await subscriptionOf(owner.id))?.termsAcceptedAt).toBeNull()
  })

  test('a Kita somebody was invited to does not stand in for the agreement', async () => {
    const host = await newAccount()
    expect(await answer(createKita(host))).toEqual(OK)
    const guest = await newAccount()
    await addTestMember(kitas.at(-1)!, guest.id, 'admin')

    expect(await answer(createKita(guest, UNTICKED))).toEqual(REFUSED)
    expect(await answer(createKita(guest))).toEqual(OK)
    expect((await subscriptionOf(guest.id))?.termsVersion).toBe('2026-10')
  })

  test('without a session the answer is the plugin’s, not a word about terms', async () => {
    const created = await post('/organization/create', {
      name: 'Kita Sonnenschein',
      slug: `kita-${randomUUID().slice(0, 18)}`,
    })
    expect(created.status).toBe(401)
  })

  // Its Kitas were deleted after the subscription ran out: only paying
  // brings one back, and the first Kita after that asks again
  test('an account whose Kitas were deleted agrees again once it has paid', async () => {
    const owner = await newAccount()
    const now = new Date()
    await setTestSubscription(owner.id, 'deletable', now)
    await testDb
      .update(hostedSubscription)
      .set({
        termsVersion: '2025-01',
        termsAcceptedAt: addDays(now, -400),
        reminderStage: 4,
        deletionNoticeAt: addDays(now, -20),
        kitasDeletedAt: addDays(now, -1),
      })
      .where(eq(hostedSubscription.userId, owner.id))

    expect(await answer(createKita(owner))).toEqual({
      status: 403,
      code: 'HOSTED_SUBSCRIPTION_INACTIVE',
    })
    expect(await ownedBy(owner)).toBe(0)

    const paid = await setPaidUntil(testDb, owner.id, addDays(now, 365), now)
    expect(paid).toMatchObject({
      reminderStage: 0,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
    })
    expect(await answer(createKita(owner, UNTICKED))).toEqual(REFUSED)
    expect(await answer(createKita(owner))).toEqual(OK)
    const row = (await subscriptionOf(owner.id))!
    expect(row.termsVersion).toBe('2026-10')
    expect(row.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime())
    // The paid period is what it was: only the agreement was written
    expect(row.paidUntil).toEqual(addDays(now, 365))
  })
})

describe('with a paid subscription', () => {
  test('takes more Kitas, the ones beyond the included three as well', async () => {
    const owner = await newAccount()
    expect(await answer(createKita(owner))).toEqual(OK)
    await setPaidUntil(testDb, owner.id, addDays(new Date(), 365), new Date())

    // The fourth works right away; what it costs is on the next invoice
    for (let i = 0; i < hostedPricing.includedKitas; i++) {
      expect(await answer(createKita(owner))).toEqual(OK)
    }
    expect(await ownedBy(owner)).toBe(hostedPricing.includedKitas + 1)
  })

  test('stops at the ceiling', async () => {
    const owner = await newAccount()
    await ownKitas(owner, HOSTED_ORGANIZATION_CAP - 1)
    await setTestSubscription(owner.id, 'active')

    expect(await answer(createKita(owner))).toEqual(OK)
    const over = await createKita(owner)
    expect({ status: over.status, code: over.code }).toEqual({
      status: 403,
      code: 'HOSTED_KITA_LIMIT',
    })
    expect(over.data?.message).toBe(
      `Mit einem Konto lassen sich höchstens ${HOSTED_ORGANIZATION_CAP} Kitas anlegen.`,
    )
    expect(await ownedBy(owner)).toBe(HOSTED_ORGANIZATION_CAP)
  })

  test('an account that is free for good creates Kitas like a paying one', async () => {
    const owner = await newAccount()
    await ownKitas(owner, 1)
    await setTestSubscription(owner.id, 'paused')
    await testDb
      .update(hostedSubscription)
      .set({ complimentary: true })
      .where(eq(hostedSubscription.userId, owner.id))
    expect(await answer(createKita(owner))).toEqual(OK)
  })
})

describe('once the subscription has run out', () => {
  test('there are no new Kitas, grace period included', async () => {
    for (const state of ['grace', 'paused', 'deletable'] as const) {
      const owner = await newAccount()
      await ownKitas(owner, 1)
      await setTestSubscription(owner.id, state)

      const refused = await createKita(owner)
      expect([state, refused.status, refused.code]).toEqual([
        state,
        403,
        'HOSTED_SUBSCRIPTION_INACTIVE',
      ])
      expect(refused.data?.message).toBe(
        'Das Abo ist abgelaufen oder pausiert. Solange lassen sich keine weiteren Kitas anlegen. Wie es weitergeht, steht unter „Abo“.',
      )
      expect(await ownedBy(owner)).toBe(1)
    }
  })
})

// An owner whose Kitas were there before HOSTED was switched on, until the
// server's hourly run has started the trial (tests/hosted-access.test.ts)
describe('an owner without a subscription', () => {
  test('is held to what a trial allows, and gets none for asking', async () => {
    const owner = await newAccount()
    await ownKitas(owner, 2)

    expect(await answer(createKita(owner))).toEqual({
      status: 403,
      code: 'HOSTED_TRIAL_ONE_KITA',
    })
    expect(await subscriptionOf(owner.id)).toBeUndefined()
  })
})

describe('without HOSTED', () => {
  beforeEach(() => {
    instanceMode.hosted = false
  })

  // No box to tick, and nothing that asks for one
  test('the limit is three Kitas, and nobody gets a subscription', async () => {
    const owner = await newAccount()
    for (let i = 0; i < ORGANIZATION_LIMIT; i++) {
      expect(await answer(createKita(owner, UNTICKED))).toEqual(OK)
    }
    expect(await answer(createKita(owner))).toEqual({
      status: 403,
      code: 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS',
    })
    expect(await subscriptionOf(owner.id)).toBeUndefined()
  })

  test('a subscription that ran out is not in the way', async () => {
    const owner = await newAccount()
    await ownKitas(owner, 1)
    await setTestSubscription(owner.id, 'deletable')
    expect(await answer(createKita(owner))).toEqual(OK)
  })
})
