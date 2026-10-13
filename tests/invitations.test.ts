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

import { invitation, member, organization, session, user } from '@/db/schema'
import { signupPolicy } from '@/lib/instance'
import { invitationView } from '@/lib/invitation-view'
import {
  INVITATION_LIMIT,
  INVITATION_TTL_S,
  ORGANIZATION_LIMIT,
} from '@/lib/limits'

import { answer, authRequests, PASSWORD, type Account } from './helpers/auth'
import { resetSpamCounters, testDb } from './helpers/spam-db'

// Invitations and roles as the handler runs them (src/lib/auth.ts), against
// the local PostgreSQL: the plugin's own checks, Kibo's hook in front of
// /organization/invite-member and the sign-up of a closed instance.
const LISTED = 'kita-verbund.example'
const kitas: string[] = []

// TEST-NET-2 is this file's network (tests/helpers/auth.ts)
const {
  fixedClient,
  get,
  newAccount,
  newEmail,
  post,
  removeAccounts,
  resetRateLimit,
} = authRequests('198.51.100.', 'invitation')

const OK = { status: 200, code: undefined }
const LINK_NAME = 'Gewinn abholen: www.evil.example'

// Through the API, so the role of its creator is the plugin's doing
async function createKita(owner: Account, name = 'Kita Sonnenschein') {
  const created = await post(
    '/organization/create',
    { name, slug: `kita-${randomUUID().slice(0, 18)}` },
    owner.cookie,
  )
  if (created.status === 200) kitas.push(String(created.data?.id))
  return created
}

async function newKita(owner: Account, name?: string) {
  const created = await createKita(owner, name)
  expect(created.status).toBe(200)
  return String(created.data?.id)
}

function invite(
  inviter: Account,
  organizationId: string,
  email: string,
  role = 'admin',
  // Pins the request to one network (tests/helpers/auth.ts)
  address?: string,
) {
  return post(
    '/organization/invite-member',
    { email, role, organizationId },
    inviter.cookie,
    address,
  )
}

function accept(account: Account, invitationId: string) {
  return post(
    '/organization/accept-invitation',
    { invitationId },
    account.cookie,
  )
}

// An invitation that went out: its id is what the mail carries
async function invited(owner: Account, organizationId: string, email: string) {
  const created = await invite(owner, organizationId, email)
  expect(created.status).toBe(200)
  return String(created.data?.id)
}

// An account that accepted an invitation to the Kita
async function newAdmin(owner: Account, organizationId: string) {
  const admin = await newAccount()
  const invitationId = await invited(owner, organizationId, admin.email)
  expect((await accept(admin, invitationId)).status).toBe(200)
  return admin
}

function membersOf(organizationId: string) {
  return testDb
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, organizationId))
    .orderBy(member.createdAt)
}

async function invitationRow(id: string) {
  const [row] = await testDb
    .select()
    .from(invitation)
    .where(eq(invitation.id, id))
  return row
}

function expire(invitationId: string) {
  return testDb
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invitation.id, invitationId))
}

beforeAll(resetRateLimit)
// The budgets for invitations and their mails, and the sign-ins per account
beforeEach(resetSpamCounters)

// The test environment is open and has no domain list (tests/preload.ts);
// tests that need another instance set it up in place
afterEach(() => {
  signupPolicy.open = true
  signupPolicy.domains.length = 0
})

afterAll(async () => {
  await resetRateLimit()
  await resetSpamCounters()
  await testDb.delete(organization).where(inArray(organization.id, kitas))
  await removeAccounts()
})

describe('roles', () => {
  test('whoever creates a Kita owns it, whoever is invited administers it', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    expect(await membersOf(kita)).toMatchObject([
      { userId: owner.id, role: 'owner' },
    ])

    const admin = await newAccount()
    const before = Date.now()
    const invitationId = await invited(owner, kita, admin.email)
    const pending = await invitationRow(invitationId)
    expect(pending).toMatchObject({
      email: admin.email,
      role: 'admin',
      status: 'pending',
      organizationId: kita,
      inviterId: owner.id,
    })
    // A week, give or take the time the request took
    const lifetime = pending!.expiresAt.getTime() - before
    expect(Math.abs(lifetime - INVITATION_TTL_S * 1000)).toBeLessThan(60_000)

    expect((await accept(admin, invitationId)).status).toBe(200)
    expect(await membersOf(kita)).toMatchObject([
      { userId: owner.id, role: 'owner' },
      { userId: admin.id, role: 'admin' },
    ])
    expect((await invitationRow(invitationId))?.status).toBe('accepted')
    // Accepting makes the Kita the active one of the session that accepted
    const sessions = await testDb
      .select({ active: session.activeOrganizationId })
      .from(session)
      .where(eq(session.userId, admin.id))
    expect(sessions).toEqual([{ active: kita }])
  })

  test('only the owner invites, withdraws, removes and renames', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    const other = await newAdmin(owner, kita)
    const waiting = await invited(owner, kita, newEmail())
    const [, , otherMember] = await membersOf(kita)

    expect(await answer(invite(admin, kita, newEmail()))).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
    })
    expect(
      await answer(
        post(
          '/organization/cancel-invitation',
          { invitationId: waiting },
          admin.cookie,
        ),
      ),
    ).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION',
    })
    // Better Auth answers this one with 401 rather than 403
    expect(
      await answer(
        post(
          '/organization/remove-member',
          { memberIdOrEmail: otherMember!.id, organizationId: kita },
          admin.cookie,
        ),
      ),
    ).toEqual({
      status: 401,
      code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
    })
    const rename = (account: Account) =>
      post(
        '/organization/update',
        { organizationId: kita, data: { name: 'Kita Regenbogen' } },
        account.cookie,
      )
    expect(await answer(rename(admin))).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
    })
    // Nothing of that happened
    expect((await invitationRow(waiting))?.status).toBe('pending')
    expect(await membersOf(kita)).toHaveLength(3)

    expect(await answer(rename(owner))).toEqual(OK)
    expect(
      await answer(
        post(
          '/organization/cancel-invitation',
          { invitationId: waiting },
          owner.cookie,
        ),
      ),
    ).toEqual(OK)
    expect((await invitationRow(waiting))?.status).toBe('canceled')
    expect(
      await answer(
        post(
          '/organization/remove-member',
          { memberIdOrEmail: otherMember!.id, organizationId: kita },
          owner.cookie,
        ),
      ),
    ).toEqual(OK)
    expect((await membersOf(kita)).map((row) => row.userId)).toEqual([
      owner.id,
      admin.id,
    ])
    // The account itself is untouched
    expect(other.id).toBe(otherMember!.userId)
    const [kept] = await testDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, other.id))
    expect(kept).toEqual({ id: other.id })
  })

  // The route would hand every member the invitations of the Kita, ids
  // included; the page lists them for the owner alone (src/lib/auth-options.ts)
  test('nobody reads the whole Kita through the API', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    const waiting = await invited(owner, kita, newEmail())

    for (const account of [admin, owner]) {
      const read = await get(
        `/organization/get-full-organization?organizationId=${kita}`,
        account.cookie,
      )
      expect(read.status).toBe(404)
      expect(JSON.stringify(read.data)).not.toContain(waiting)
    }
  })

  test('an admin may leave, the owner may not', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    const leave = (account: Account) =>
      post('/organization/leave', { organizationId: kita }, account.cookie)

    expect(await answer(leave(owner))).toEqual({
      status: 400,
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
    })
    expect(await answer(leave(admin))).toEqual(OK)
    expect((await membersOf(kita)).map((row) => row.userId)).toEqual([owner.id])
  })
})

describe('inviting', () => {
  test('makes admins and nothing else', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    for (const role of ['owner', 'member', 'admin,owner']) {
      expect(await answer(invite(owner, kita, newEmail(), role))).toEqual({
        status: 400,
        code: 'INVALID_INVITATION_ROLE',
      })
    }
    const rows = await testDb
      .select({ id: invitation.id })
      .from(invitation)
      .where(eq(invitation.organizationId, kita))
    expect(rows).toEqual([])
  })

  test('asks for a session and for a Kita of the caller', async () => {
    const owner = await newAccount()
    const stranger = await newAccount()
    const kita = await newKita(owner)
    const body = { email: newEmail(), role: 'admin', organizationId: kita }
    expect((await post('/organization/invite-member', body)).status).toBe(401)
    expect(
      (await post('/organization/invite-member', body, stranger.cookie)).status,
    ).toBe(400)
  })

  test('applies the domain list, and says so to the owner only', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    signupPolicy.domains.push(LISTED)

    expect(
      await answer(invite(owner, kita, newEmail('gmail.example'))),
    ).toEqual({ status: 403, code: 'EMAIL_DOMAIN_NOT_ALLOWED' })
    expect(await answer(invite(owner, kita, newEmail(LISTED)))).toEqual(OK)
    // Whoever may not invite hears that, not what the list says
    expect(
      await answer(invite(admin, kita, newEmail('gmail.example'))),
    ).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
    })
  })

  // The mail names the Kita and goes to an address of the owner's choosing
  test('a Kita cannot be given a name that reads like a link', async () => {
    const owner = await newAccount()
    const refused = { status: 400, code: 'ORGANIZATION_NAME_LOOKS_LIKE_LINK' }
    expect(await answer(createKita(owner, LINK_NAME))).toEqual(refused)

    const kita = await newKita(owner)
    expect(
      await answer(
        post(
          '/organization/update',
          { organizationId: kita, data: { name: LINK_NAME } },
          owner.cookie,
        ),
      ),
    ).toEqual(refused)
    expect(await answer(invite(owner, kita, newEmail()))).toEqual(OK)
  })

  // A name stored before creating and renaming refused it
  test('refuses while the name of the Kita reads like a link', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    await testDb
      .update(organization)
      .set({ name: LINK_NAME })
      .where(eq(organization.id, kita))
    expect(await answer(invite(owner, kita, newEmail()))).toEqual({
      status: 400,
      code: 'ORGANIZATION_NAME_LOOKS_LIKE_LINK',
    })
  })

  test('a Kita has a budget per hour, which an admin cannot spend', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    // One invitation went to the admin; the counters start afresh
    await resetSpamCounters()

    for (let i = 0; i < 12; i++) {
      expect((await invite(admin, kita, newEmail())).status).toBe(403)
    }
    // Ten an hour, each to an address of its own: one address alone takes
    // fewer than that (below)
    for (let i = 0; i < 10; i++) {
      expect((await invite(owner, kita, newEmail())).status).toBe(200)
    }
    const refused = await invite(owner, kita, newEmail())
    expect(refused.status).toBe(429)
    expect(refused.code).toBe('TOO_MANY_INVITATIONS')
    const wait = Number(refused.headers.get('x-retry-after'))
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(3600)
  })

  // The mail budget of the address (src/lib/spam/budgets.ts), asked before
  // the invitation is created: a refusal must not withdraw the link the
  // address already has in favour of one that is never sent
  test('an address takes three an hour from one network, and keeps its link', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const invitee = await newAccount()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const sent = await invite(
        owner,
        kita,
        invitee.email,
        'admin',
        fixedClient,
      )
      expect(sent.status).toBe(200)
      ids.push(String(sent.data?.id))
    }

    // Written differently, it is still the same address
    const refused = await invite(
      owner,
      kita,
      invitee.email.toUpperCase(),
      'admin',
      fixedClient,
    )
    expect(refused.status).toBe(429)
    expect(refused.code).toBe('TOO_MANY_INVITATIONS')
    const wait = Number(refused.headers.get('x-retry-after'))
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(3600)

    // Nothing was created, and the last link that went out still works
    const rows = await testDb
      .select({ id: invitation.id })
      .from(invitation)
      .where(eq(invitation.organizationId, kita))
    expect(rows).toHaveLength(3)
    expect((await invitationRow(ids[1]!))?.status).toBe('canceled')
    expect((await invitationRow(ids[2]!))?.status).toBe('pending')
    expect(await answer(accept(invitee, ids[2]!))).toEqual(OK)
  })

  // Not a string: nothing to count, and the plugin says what is wrong
  test('leaves a request without an address to the plugin', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const refused = await post(
      '/organization/invite-member',
      { email: { address: newEmail() }, role: 'admin', organizationId: kita },
      owner.cookie,
    )
    expect(refused.status).toBe(400)
    expect(refused.code).not.toBe('TOO_MANY_INVITATIONS')
  })

  test('a Kita has at most ten invitations waiting', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    for (let i = 0; i < INVITATION_LIMIT; i++) {
      expect((await invite(owner, kita, newEmail())).status).toBe(200)
    }
    await resetSpamCounters()
    expect(await answer(invite(owner, kita, newEmail()))).toEqual({
      status: 403,
      code: 'INVITATION_LIMIT_REACHED',
    })
  })

  test('inviting again withdraws the earlier link', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAccount()
    const first = await invited(owner, kita, admin.email)
    const second = await invited(owner, kita, admin.email)

    expect(second).not.toBe(first)
    expect((await invitationRow(first))?.status).toBe('canceled')
    expect((await invitationRow(second))?.status).toBe('pending')
    expect(await answer(accept(admin, first))).toEqual({
      status: 400,
      code: 'INVITATION_NOT_FOUND',
    })
    expect(await answer(accept(admin, second))).toEqual(OK)
    // Someone who is in is not invited a second time
    expect(await answer(invite(owner, kita, admin.email))).toEqual({
      status: 400,
      code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
    })
  })
})

describe('answering an invitation', () => {
  test('takes the invited account, signed in', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const invitee = await newAccount()
    const other = await newAccount()
    const invitationId = await invited(owner, kita, invitee.email)

    expect(
      (await post('/organization/accept-invitation', { invitationId })).status,
    ).toBe(401)
    expect(await answer(accept(other, invitationId))).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
    })
    expect(await membersOf(kita)).toHaveLength(1)
    expect((await invitationRow(invitationId))?.status).toBe('pending')
  })

  test('can be rejected, once', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const invitee = await newAccount()
    const invitationId = await invited(owner, kita, invitee.email)
    const reject = () =>
      post('/organization/reject-invitation', { invitationId }, invitee.cookie)

    expect(await answer(reject())).toEqual(OK)
    expect((await invitationRow(invitationId))?.status).toBe('rejected')
    expect((await reject()).status).toBe(400)
    expect(await answer(accept(invitee, invitationId))).toEqual({
      status: 400,
      code: 'INVITATION_NOT_FOUND',
    })
    expect(await membersOf(kita)).toHaveLength(1)
  })

  test('is over after a week', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const invitee = await newAccount()
    const invitationId = await invited(owner, kita, invitee.email)
    await expire(invitationId)

    expect(await answer(accept(invitee, invitationId))).toEqual({
      status: 400,
      code: 'INVITATION_NOT_FOUND',
    })
  })
})

// What /admin/invitation shows (src/lib/invitation-view.ts)
describe('the invitation page', () => {
  const as = (account: Account) => new Headers({ cookie: account.cookie })

  test('shows a guest the Kita and never the invited address', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner, 'Kita Waldwichtel')
    const email = newEmail()
    const id = await invited(owner, kita, email)

    const view = await invitationView(id, false, new Headers())
    expect(view).toEqual({
      state: 'guest',
      id,
      organizationName: 'Kita Waldwichtel',
    })
    expect(JSON.stringify(view)).not.toContain(email)
  })

  test('lets the invited account answer and turns another one away', async () => {
    const owner = await newAccount(undefined, 'Olga Inhaberin')
    const kita = await newKita(owner, 'Kita Waldwichtel')
    const invitee = await newAccount()
    const other = await newAccount()
    const id = await invited(owner, kita, invitee.email)

    expect(await invitationView(id, true, as(invitee))).toEqual({
      state: 'recipient',
      id,
      organizationName: 'Kita Waldwichtel',
      inviterName: 'Olga Inhaberin',
    })
    expect(await invitationView(id, true, as(other))).toEqual({
      state: 'wrong-account',
    })
    // Looking at it answered nothing
    expect((await invitationRow(id))?.status).toBe('pending')
  })

  test('says the same for every link that leads nowhere', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const invitee = await newAccount()
    const expired = await invited(owner, kita, invitee.email)
    await expire(expired)
    const withdrawn = await invited(owner, kita, newEmail())
    await post(
      '/organization/cancel-invitation',
      { invitationId: withdrawn },
      owner.cookie,
    )

    for (const id of [expired, withdrawn, 'unbekannt', '', null]) {
      expect(await invitationView(id, false, new Headers())).toEqual({
        state: 'gone',
      })
    }
    expect(await invitationView(expired, true, as(invitee))).toEqual({
      state: 'gone',
    })
  })
})

describe('the limit of Kitas per account', () => {
  test('counts the Kitas an account owns, not the ones it was invited to', async () => {
    const owner = await newAccount()
    const guest = await newAccount()
    for (let i = 0; i < ORGANIZATION_LIMIT; i++) {
      const kita = await newKita(owner)
      const invitationId = await invited(owner, kita, guest.email)
      expect((await accept(guest, invitationId)).status).toBe(200)
    }

    // Three Kitas of their own: the owner is at the limit
    expect(await answer(createKita(owner))).toEqual({
      status: 403,
      code: 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS',
    })
    // Admin in three Kitas, owner of none: the guest still has all three
    for (let i = 0; i < ORGANIZATION_LIMIT; i++) {
      expect((await createKita(guest)).status).toBe(200)
    }
    expect((await createKita(guest)).status).toBe(403)

    // And an invitation never fails on the limit: the owner of three joins a
    // fourth Kita as admin
    const host = await newAccount()
    const fourth = await newKita(host)
    const invitationId = await invited(host, fourth, owner.email)
    expect(await answer(accept(owner, invitationId))).toEqual(OK)
  })
})

describe('signing up on a closed instance', () => {
  const SIGNUP_CLOSED = { status: 403, code: 'SIGNUP_CLOSED' }

  function signUp(email: string, invitationId?: unknown) {
    return post('/sign-up/email', {
      name: 'Bea Beispiel',
      email,
      password: PASSWORD,
      invitationId,
    })
  }

  async function accountOf(email: string) {
    const [row] = await testDb
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, email))
    return row
  }

  test('takes the invited address with the id from its link, and nothing else', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const email = newEmail()
    const invitationId = await invited(owner, kita, email)
    const forSomeoneElse = await invited(owner, kita, newEmail())
    const expiredEmail = newEmail()
    const expired = await invited(owner, kita, expiredEmail)
    await expire(expired)
    signupPolicy.open = false

    // Every way of not holding the right link gets the same answer, so the
    // sign-up says nothing about who has been invited
    expect(await answer(signUp(email))).toEqual(SIGNUP_CLOSED)
    expect(await answer(signUp(email, 'unbekannt'))).toEqual(SIGNUP_CLOSED)
    expect(await answer(signUp(email, forSomeoneElse))).toEqual(SIGNUP_CLOSED)
    expect(await answer(signUp(email, { id: invitationId }))).toEqual(
      SIGNUP_CLOSED,
    )
    expect(await answer(signUp(newEmail(), invitationId))).toEqual(
      SIGNUP_CLOSED,
    )
    expect(await answer(signUp(expiredEmail, expired))).toEqual(SIGNUP_CLOSED)
    expect(await accountOf(email)).toBeUndefined()

    const signedUp = await signUp(email.toUpperCase(), invitationId)
    expect(signedUp.status).toBe(200)
    // An account that still has to confirm its address, and no session: the
    // link of an invitation is no way around the login
    expect(await accountOf(email)).toMatchObject({ emailVerified: false })
    expect(signedUp.headers.getSetCookie().join(';')).not.toContain(
      'session_token',
    )
    expect(signedUp.data?.token ?? null).toBeNull()
    const sessions = await testDb
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, (await accountOf(email))!.id))
    expect(sessions).toEqual([])
    // Signing up accepted nothing either
    expect((await invitationRow(invitationId))?.status).toBe('pending')
    expect(await membersOf(kita)).toHaveLength(1)
  })

  test('the domain list holds for the invited as well', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    // Invited before the list was put in place
    const outside = newEmail('gmail.example')
    const outsideId = await invited(owner, kita, outside)
    signupPolicy.domains.push(LISTED)
    const listed = newEmail(LISTED)
    const listedId = await invited(owner, kita, listed)
    signupPolicy.open = false

    expect(await answer(signUp(outside, outsideId))).toEqual({
      status: 403,
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    })
    expect((await signUp(listed, listedId)).status).toBe(200)
  })

  test('an open instance ignores the id', async () => {
    const email = newEmail()
    expect((await signUp(email, 'unbekannt')).status).toBe(200)
    expect(await accountOf(email)).toMatchObject({ emailVerified: false })
  })
})

describe('deleting an account', () => {
  function deleteAccount(account: Account) {
    return post('/delete-user', { password: PASSWORD }, account.cookie)
  }

  async function kitaExists(id: string) {
    const rows = await testDb
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, id))
    return rows.length > 0
  }

  test('an owner takes their Kitas along, admins or not', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)
    const waiting = await invited(owner, kita, newEmail())

    expect((await deleteAccount(owner)).status).toBe(200)

    expect(await kitaExists(kita)).toBe(false)
    expect(await invitationRow(waiting)).toBeUndefined()
    // The admin keeps their account and loses the membership
    const rows = await testDb
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, [owner.id, admin.id]))
    expect(rows).toEqual([{ id: admin.id }])
    const memberships = await testDb
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, admin.id))
    expect(memberships).toEqual([])
  })

  test('an admin leaves the Kita to its owner', async () => {
    const owner = await newAccount()
    const kita = await newKita(owner)
    const admin = await newAdmin(owner, kita)

    expect((await deleteAccount(admin)).status).toBe(200)

    expect(await kitaExists(kita)).toBe(true)
    expect((await membersOf(kita)).map((row) => row.userId)).toEqual([owner.id])
  })
})
