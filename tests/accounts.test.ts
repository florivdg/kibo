import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, test } from 'bun:test'
import { inArray } from 'drizzle-orm'

import {
  invitation,
  member,
  organization,
  rateLimit,
  session,
  user,
  verification,
} from '@/db/schema'
import {
  LONGEST_RATE_LIMIT_WINDOW_MS,
  purgeExpiredSessions,
  purgeExpiredVerifications,
  purgeStaleRateLimits,
} from '@/lib/expired-sessions'
import { INVITATION_TTL_DAYS } from '@/lib/limits'
import { invitationMail, passwordResetMail } from '@/lib/mail/templates'
import {
  countOwnedOrganizations,
  deleteOwnedOrganizations,
  ownedOrganizations,
  rememberOrganizationsOf,
} from '@/lib/organization-access'
import {
  pendingInvitationFor,
  purgeInvitations,
} from '@/lib/organization-members'
import {
  purgeUnverifiedAccounts,
  UNVERIFIED_ACCOUNT_TTL_MS,
} from '@/lib/unverified-accounts'

import { testDb } from './helpers/spam-db'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-05-04T10:00:00.000Z')
const users: string[] = []
const organizations: string[] = []

async function createUser(emailVerified: boolean, createdAt: Date) {
  const id = `test-${randomUUID()}`
  users.push(id)
  await testDb.insert(user).values({
    id,
    name: 'Test',
    email: `${id}@example.org`,
    emailVerified,
    createdAt,
    updatedAt: createdAt,
  })
  return id
}

// A Kita with its owner and the admins they invited
async function createOrganization(
  { owner, admins = [] }: { owner?: string; admins?: string[] } = {},
  name = 'Test-Kita',
) {
  const id = `test-${randomUUID()}`
  organizations.push(id)
  await testDb
    .insert(organization)
    .values({ id, name, slug: id, createdAt: now })
  const members = [
    ...(owner ? [{ userId: owner, role: 'owner' }] : []),
    ...admins.map((userId) => ({ userId, role: 'admin' })),
  ]
  for (const { userId, role } of members) {
    await testDb.insert(member).values({
      id: randomUUID(),
      organizationId: id,
      userId,
      role,
      createdAt: now,
    })
  }
  return id
}

async function createInvitation(
  organizationId: string,
  inviterId: string,
  values: Partial<typeof invitation.$inferInsert> = {},
) {
  const id = `test-${randomUUID()}`
  await testDb.insert(invitation).values({
    id,
    organizationId,
    inviterId,
    email: `${id}@example.org`,
    role: 'admin',
    status: 'pending',
    expiresAt: new Date(now.getTime() + DAY),
    createdAt: now,
    ...values,
  })
  return id
}

async function existing(
  table: typeof user | typeof organization | typeof invitation,
  ids: string[],
) {
  const rows = await testDb
    .select({ id: table.id })
    .from(table)
    .where(inArray(table.id, ids))
  return rows.map((row) => row.id).sort()
}

afterAll(async () => {
  await testDb
    .delete(organization)
    .where(inArray(organization.id, organizations))
  await testDb.delete(user).where(inArray(user.id, users))
})

describe('purgeUnverifiedAccounts', () => {
  test('removes sign-ups nobody confirmed within a week, and only those', async () => {
    const old = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_MS - DAY)
    const abandoned = await createUser(false, old)
    const recent = await createUser(false, new Date(now.getTime() - DAY))
    const verified = await createUser(true, old)
    // Unconfirmed but running a Kita: left alone
    const withKita = await createUser(false, old)
    await createOrganization({ owner: withKita })

    await purgeUnverifiedAccounts(now)

    expect(
      await existing(user, [abandoned, recent, verified, withKita]),
    ).toEqual([recent, verified, withKita].sort())
  })
})

describe('purgeExpiredSessions', () => {
  test('removes expired sessions and keeps running ones', async () => {
    const owner = await createUser(true, now)
    const session_ = (id: string, expiresAt: Date) => ({
      id,
      token: id,
      userId: owner,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: '203.0.113.7',
    })
    const expired = `test-${randomUUID()}`
    const running = `test-${randomUUID()}`
    await testDb
      .insert(session)
      .values([
        session_(expired, new Date(now.getTime() - DAY)),
        session_(running, new Date(now.getTime() + DAY)),
      ])

    await purgeExpiredSessions(now)

    const rows = await testDb
      .select({ id: session.id })
      .from(session)
      .where(inArray(session.id, [expired, running]))
    expect(rows.map((row) => row.id)).toEqual([running])
  })
})

// Links nobody followed and passkey challenges nobody used
describe('purgeExpiredVerifications', () => {
  const expired = `test-${randomUUID()}`
  const live = `test-${randomUUID()}`

  afterAll(async () => {
    await testDb
      .delete(verification)
      .where(inArray(verification.id, [expired, live]))
  })

  test('removes expired rows and keeps live ones', async () => {
    const row = (id: string, expiresAt: Date) => ({
      id,
      identifier: id,
      value: '{}',
      expiresAt,
    })
    await testDb
      .insert(verification)
      .values([
        row(expired, new Date(now.getTime() - DAY)),
        row(live, new Date(now.getTime() + DAY)),
      ])

    await purgeExpiredVerifications(now)

    const rows = await testDb
      .select({ id: verification.id })
      .from(verification)
      .where(inArray(verification.id, [expired, live]))
    expect(rows.map((row) => row.id)).toEqual([live])
  })
})

// Better Auth's counters, `IP|path` in clear, once no window needs them
describe('purgeStaleRateLimits', () => {
  // A documentation network no other file uses
  const key = (name: string) => `192.0.2.250|/test/${name}-${randomUUID()}`
  const keys: string[] = []

  afterAll(async () => {
    await testDb.delete(rateLimit).where(inArray(rateLimit.key, keys))
  })

  test('the longest window is the hour of the mail routes', () => {
    expect(LONGEST_RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000)
  })

  test('removes rows past the longest window and a margin', async () => {
    const at = now.getTime()
    const rows = {
      // Within the window, or just past it: a request could still count
      running: at - 60_000,
      window: at - LONGEST_RATE_LIMIT_WINDOW_MS - 60_000,
      // Well past window and margin
      stale: at - LONGEST_RATE_LIMIT_WINDOW_MS - 10 * 60_000,
      ancient: at - 30 * DAY,
    }
    const named = Object.entries(rows).map(([name, lastRequest]) => ({
      name,
      row: { id: randomUUID(), key: key(name), count: 3, lastRequest },
    }))
    keys.push(...named.map(({ row }) => row.key))
    await testDb.insert(rateLimit).values(named.map(({ row }) => row))

    await purgeStaleRateLimits(now)

    const left = await testDb
      .select({ key: rateLimit.key })
      .from(rateLimit)
      .where(inArray(rateLimit.key, keys))
    const names = named
      .filter(({ row }) => left.some(({ key }) => key === row.key))
      .map(({ name }) => name)
    expect(names.toSorted()).toEqual(['running', 'window'])
  })
})

// What Better Auth does around deleting an account: beforeDelete, the user
// row, afterDelete
async function deleteAccount(id: string) {
  await rememberOrganizationsOf({ id })
  await testDb.delete(user).where(inArray(user.id, [id]))
  await deleteOwnedOrganizations({ id })
}

describe('deleteOwnedOrganizations', () => {
  // The owner answers for a Kita: it goes with their account, admins or not.
  // A Kita being created right now has no member row yet either; deleting an
  // account must only ever sweep that account's own Kitas.
  test('removes the Kitas the deleted account owned, and only those', async () => {
    const leaving = await createUser(true, now)
    const colleague = await createUser(true, now)
    const alone = await createOrganization({ owner: leaving })
    const shared = await createOrganization({
      owner: leaving,
      admins: [colleague],
    })
    const colleagues = await createOrganization({
      owner: colleague,
      admins: [leaving],
    })
    const someoneElses = await createOrganization()

    await deleteAccount(leaving)

    expect(
      await existing(organization, [alone, shared, colleagues, someoneElses]),
    ).toEqual([colleagues, someoneElses].sort())
    // The admin of the deleted Kita keeps their account and their own Kita
    expect(await existing(user, [leaving, colleague])).toEqual([colleague])
    const memberships = await testDb
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(inArray(member.userId, [colleague]))
    expect(memberships).toEqual([{ organizationId: colleagues }])
  })

  test('an admin takes nothing but their membership along', async () => {
    const owner = await createUser(true, now)
    const admin = await createUser(true, now)
    const kita = await createOrganization({ owner, admins: [admin] })

    await deleteAccount(admin)

    expect(await existing(organization, [kita])).toEqual([kita])
    const members = await testDb
      .select({ userId: member.userId })
      .from(member)
      .where(inArray(member.organizationId, [kita]))
    expect(members).toEqual([{ userId: owner }])
  })
})

describe('owned Kitas', () => {
  test('counts and lists what an account owns, not what it was invited to', async () => {
    const owner = await createUser(true, now)
    const first = await createUser(true, now)
    const second = await createUser(true, now)
    const birke = await createOrganization(
      { owner, admins: [first, second] },
      'Kita Birke',
    )
    const ahorn = await createOrganization({ owner }, 'Kita Ahorn')
    await createOrganization({ owner: first, admins: [owner] }, 'Kita Linde')

    expect(await countOwnedOrganizations(owner)).toBe(2)
    expect(await countOwnedOrganizations(second)).toBe(0)
    // With the id: two Kitas of one owner may share a name
    expect(await ownedOrganizations(owner)).toEqual([
      { id: ahorn, name: 'Kita Ahorn', otherMembers: 0 },
      { id: birke, name: 'Kita Birke', otherMembers: 2 },
    ])
    expect(await ownedOrganizations(second)).toEqual([])
  })
})

describe('invitations', () => {
  // Answered and expired invitations are addresses nobody needs any more
  test('the hourly run keeps only what can still be accepted', async () => {
    const owner = await createUser(true, now)
    const kita = await createOrganization({ owner })
    const past = new Date(now.getTime() - DAY)
    const open = await createInvitation(kita, owner)
    const expired = await createInvitation(kita, owner, { expiresAt: past })
    const accepted = await createInvitation(kita, owner, { status: 'accepted' })
    const rejected = await createInvitation(kita, owner, { status: 'rejected' })
    const canceled = await createInvitation(kita, owner, { status: 'canceled' })

    await purgeInvitations(now)

    expect(
      await existing(invitation, [open, expired, accepted, rejected, canceled]),
    ).toEqual([open])
  })

  // Where the middleware sends someone who signed in without a Kita
  test('finds the newest open invitation of an address', async () => {
    const owner = await createUser(true, now)
    const kita = await createOrganization({ owner })
    const email = `eingeladen-${randomUUID()}@example.org`
    const earlier = new Date(now.getTime() - DAY)
    await createInvitation(kita, owner, { email, createdAt: earlier })
    const newest = await createInvitation(kita, owner, { email })
    await createInvitation(kita, owner, { email, status: 'canceled' })

    expect(await pendingInvitationFor(email, now)).toBe(newest)
    expect(await pendingInvitationFor(` ${email.toUpperCase()} `, now)).toBe(
      newest,
    )
    // Over by then, all of them
    const later = new Date(now.getTime() + 2 * DAY)
    expect(await pendingInvitationFor(email, later)).toBeNull()
    expect(await pendingInvitationFor('niemand@example.org', now)).toBeNull()
  })
})

describe('mail templates', () => {
  test('the plain-text version names the action, then the link', () => {
    const url = 'https://kibo.example/reset'
    const { text } = passwordResetMail('Anna', url)
    expect(text).toContain(`Neues Passwort vergeben:\n${url}\n\n`)
    expect(text).toContain('Der Link ist eine Stunde gültig.')
    expect(text).not.toContain('Button')
    // The signature, then the footer every mail has (tests/mail-footer.test.ts)
    expect(text).toContain('Viele Grüße\nIhr Kibo-Team\n\n-- \n')
  })

  // Goes to an address Kibo knows no name for, with a link that waits a week
  test('an invitation says who invites to which Kita', () => {
    const url = 'https://kibo.example/admin/invitation?id=abc'
    const { subject, text, html } = invitationMail({
      organizationName: 'Kita <Sonnenschein>',
      inviterName: 'Anna Beispiel',
      url,
    })
    expect(subject).toBe('Einladung zur Kita „Kita <Sonnenschein>“ bei Kibo')
    expect(text.startsWith('Hallo,\n\nAnna Beispiel hat Sie eingeladen')).toBe(
      true,
    )
    expect(text).toContain(`Einladung ansehen:\n${url}\n\n`)
    expect(text).toContain(`Der Link ist ${INVITATION_TTL_DAYS} Tage gültig.`)
    expect(text).not.toContain('eine Stunde')
    expect(html).toContain('Kita &lt;Sonnenschein&gt;')
    expect(html).not.toContain('<Sonnenschein>')
  })
})
