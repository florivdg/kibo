import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { boardBudgetKey, kitaBudgetKey } from '@/lib/board/kita-link'
import {
  INVITATION_BUDGETS,
  NOTE_BOARD_BUDGETS,
  NOTE_CLIENT_BOARD_BUDGETS,
  NOTE_CLIENT_BUDGETS,
  NOTE_KITA_BUDGETS,
  NOTE_WIDE_CLIENT_BUDGETS,
  REPORT_CLIENT_BUDGETS,
  REPORT_WIDE_CLIENT_BUDGETS,
  SIGN_IN_BUDGETS,
  waitLabel,
} from '@/lib/spam/budgets'
import { clientNetworks } from '@/lib/spam/client-ip'
import {
  allowAuthMail,
  allowBoardPost,
  allowClientBoardPost,
  allowInvitation,
  allowInvitationMail,
  allowNoteList,
  allowNotePost,
  allowNoteRemoval,
  allowReport,
  allowSignIn,
  claimNoteContent,
} from '@/lib/spam/guard'

import {
  newNoteId,
  removeTestBoard,
  resetSpamCounters,
  testDb,
} from './helpers/spam-db'

const now = new Date('2026-05-04T10:00:00.000Z')
const limitOf = (name: string) =>
  [
    ...NOTE_CLIENT_BUDGETS,
    ...NOTE_CLIENT_BOARD_BUDGETS,
    ...NOTE_WIDE_CLIENT_BUDGETS,
    ...NOTE_BOARD_BUDGETS,
    ...NOTE_KITA_BUDGETS,
    ...REPORT_CLIENT_BUDGETS,
    ...REPORT_WIDE_CLIENT_BUDGETS,
    ...SIGN_IN_BUDGETS,
    ...INVITATION_BUDGETS,
  ].find((budget) => budget.name === name)!.max

// A request the way it reaches Better Auth behind the proxy
const from = (address: string) =>
  new Request('http://localhost/api/auth', {
    headers: { 'x-forwarded-for': address },
  })

// The subjects of the budgets inside the transaction of notes.create: a
// board under a Kita's link, and that Kita link
const onBoard = (boardId: string, kitaToken = 'kita-token') => ({
  board: boardBudgetKey({ kitaToken, boardId }),
  kita: kitaBudgetKey(kitaToken),
})

// A visitor's networks, from the address the proxy hands on
const networksOf = (address: string) => clientNetworks(address, undefined)

// An address in /64 number `net` of /56 number `line` of the /48 `site`
const ipv6In = (line: number, net: number, site = '2001:db8:aaaa') =>
  `${site}:${line.toString(16).padStart(2, '0')}${net
    .toString(16)
    .padStart(2, '0')}::1`

beforeEach(resetSpamCounters)
afterAll(removeTestBoard)

describe('allowNotePost', () => {
  test('lets a parent pin a few notes and then asks them to wait', async () => {
    const client = { client: 'ip4:203.0.113.7' }
    const burst = limitOf('note:burst')
    for (let i = 0; i < burst; i++) {
      expect((await allowNotePost(client, now)).allowed).toBe(true)
    }
    const blocked = await allowNotePost(client, now)
    expect(blocked.allowed).toBe(false)
    // German, and it names how long to wait
    expect(blocked.message).toContain('Minuten')
    expect(blocked.message).toContain('Text bleibt')
  })

  test('another network is not caught by it', async () => {
    const burst = limitOf('note:burst')
    for (let i = 0; i < burst + 2; i++) {
      await allowNotePost({ client: 'ip4:203.0.113.7' }, now)
    }
    expect(
      (await allowNotePost({ client: 'ip6:2001:0db8:0000:0001::/64' }, now))
        .allowed,
    ).toBe(true)
  })

  test('several parents behind one address can post normally', async () => {
    // Eight notes spread over 40 minutes from one Kita WLAN, the way a
    // parents' evening looks: well inside the hourly budget
    const client = { client: 'ip4:203.0.113.7' }
    const spread = [0, 6, 12, 18, 24, 30, 36, 42].map(
      (minutes) => new Date(now.getTime() + minutes * 60_000),
    )
    for (const moment of spread) {
      expect((await allowNotePost(client, moment)).allowed).toBe(true)
    }
  })

  // K-1: the board budget is everyone's, so a single noisy network must not be
  // able to spend it and lock the board for the rest of the day
  test('a client that is over its budget spends none of the board budget', async () => {
    const client = { client: 'ip4:203.0.113.7' }
    const attempts = limitOf('note:board-hour') + 10
    for (let i = 0; i < attempts; i++) {
      const verdict = await allowNotePost(client, now)
      // Only the accepted ones ever reach the board budget
      if (verdict.allowed) await allowBoardPost(onBoard('board-1'), now, testDb)
    }
    // Another network still gets onto the same board
    expect(
      (await allowNotePost({ client: 'ip4:198.51.100.1' }, now)).allowed,
    ).toBe(true)
    expect(
      (await allowBoardPost(onBoard('board-1'), now, testDb)).allowed,
    ).toBe(true)
  })

  test('one network fills one board only so far', async () => {
    const client = 'ip4:203.0.113.7'
    const limit = limitOf('note:client-board-day')
    for (let i = 0; i < limit; i++) {
      const moment = new Date(now.getTime() + i * 10 * 60_000)
      expect(
        (await allowClientBoardPost(client, 'token-1', moment)).allowed,
      ).toBe(true)
    }
    const later = new Date(now.getTime() + limit * 10 * 60_000)
    expect((await allowClientBoardPost(client, 'token-1', later)).allowed).toBe(
      false,
    )
    expect((await allowClientBoardPost(client, 'token-2', later)).allowed).toBe(
      true,
    )
  })

  // Renewing the link is the answer to a spammed board, and it must not leave
  // the board shut for the rest of the day
  test('a renewed link starts with a fresh board budget', async () => {
    const old = { board: 'old-token|board-1', kita: 'old-token' }
    for (let i = 0; i < limitOf('note:board-hour'); i++) {
      await allowBoardPost(old, now, testDb)
    }
    expect((await allowBoardPost(old, now, testDb)).allowed).toBe(false)
    expect(
      (
        await allowBoardPost(
          { board: 'new-token|board-1', kita: 'new-token' },
          now,
          testDb,
        )
      ).allowed,
    ).toBe(true)
  })

  test('the board budget exists and is far above normal use', async () => {
    expect(limitOf('note:board-day')).toBeGreaterThanOrEqual(200)
    expect(limitOf('note:client-day')).toBeLessThan(limitOf('note:board-day'))
  })
})

// A home line has a /56 and a cheap server a /48: every /64 in it has budgets
// of its own, the whole prefix one more
describe('allowNotePost for the wider IPv6 networks', () => {
  test('many /64s of one /56 together hit its limit', async () => {
    const limit = limitOf('note:client56-hour')
    for (let net = 0; net < limit; net++) {
      expect(
        (await allowNotePost(networksOf(ipv6In(1, net)), now)).allowed,
      ).toBe(true)
    }
    const refused = await allowNotePost(networksOf(ipv6In(1, limit)), now)
    expect(refused.allowed).toBe(false)
    // The wait is that of the hour, not of the five minutes
    expect(refused.retryAfterMs).toBeGreaterThan(5 * 60_000)
    expect(refused.message).toContain('Stunde')
    // The next /56 of the same /48 is a home line of its own
    expect((await allowNotePost(networksOf(ipv6In(2, 0)), now)).allowed).toBe(
      true,
    )
  })

  test('one /64 over its own budget spends none of its /56', async () => {
    const noisy = networksOf(ipv6In(1, 0))
    for (let i = 0; i < 50; i++) await allowNotePost(noisy, now)
    // Only what got past the /64's own burst counted for the /56
    const left = limitOf('note:client56-hour') - limitOf('note:burst')
    for (let net = 1; net <= left; net++) {
      expect(
        (await allowNotePost(networksOf(ipv6In(1, net)), now)).allowed,
      ).toBe(true)
    }
    expect(
      (await allowNotePost(networksOf(ipv6In(1, left + 1)), now)).allowed,
    ).toBe(false)
  })

  test('the /56s of one /48 together hit its daily limit', async () => {
    const limit = limitOf('note:client48-day')
    // Thirty from each /56, inside its own budgets
    for (let i = 0; i < limit; i++) {
      const verdict = await allowNotePost(
        networksOf(ipv6In(Math.floor(i / 30), i % 30)),
        now,
      )
      expect(verdict.allowed).toBe(true)
    }
    const fresh = Math.ceil(limit / 30)
    expect(
      (await allowNotePost(networksOf(ipv6In(fresh, 0)), now)).allowed,
    ).toBe(false)
    expect(
      (await allowNotePost(networksOf(ipv6In(fresh, 0, '2001:db8:bbbb')), now))
        .allowed,
    ).toBe(true)
  })

  test('IPv4 has no wider network', async () => {
    const limit = limitOf('note:client-hour')
    // The neighbours of a /24 have budgets of their own, whatever is used up
    for (let host = 1; host <= limit * 4; host++) {
      expect(
        (await allowNotePost(networksOf(`203.0.113.${host}`), now)).allowed,
      ).toBe(true)
    }
  })
})

describe('wider IPv6 network isolation', () => {
  test.each([
    ['note', allowNotePost],
    ['report', allowReport],
  ] as const)(
    '%s: a blocked /56 spends none of its /48',
    async (action, allow) => {
      const attempts = limitOf(`${action}:client48-day`)
      let accepted = 0
      for (let i = 0; i < attempts; i++) {
        // Rotate through one /56, keeping every /64 below its own burst limit.
        if ((await allow(networksOf(ipv6In(1, i % 256)), now)).allowed) {
          accepted += 1
        }
      }
      expect(accepted).toBe(limitOf(`${action}:client56-hour`))
      // The refused attempts must not lock another home line out for the day.
      expect((await allow(networksOf(ipv6In(2, 0)), now)).allowed).toBe(true)
    },
  )
})

describe('allowReport for the wider IPv6 networks', () => {
  test('many /64s of one /56 together hit its limit', async () => {
    const limit = limitOf('report:client56-hour')
    expect(limit).toBe(3 * limitOf('report:client-hour'))
    for (let net = 0; net < limit; net++) {
      expect((await allowReport(networksOf(ipv6In(1, net)), now)).allowed).toBe(
        true,
      )
    }
    expect((await allowReport(networksOf(ipv6In(1, limit)), now)).allowed).toBe(
      false,
    )
    expect((await allowReport(networksOf(ipv6In(2, 0)), now)).allowed).toBe(
      true,
    )
  })
})

// The boards of one Kita share a budget, counted for its current link
describe('allowBoardPost for the Kita', () => {
  test('notes spread over several boards hit the Kita limit', async () => {
    const limit = limitOf('note:kita-hour')
    // Below every board's own hourly budget
    const perBoard = limitOf('note:board-hour') / 2
    for (let i = 0; i < limit; i++) {
      const target = onBoard(`board-${Math.floor(i / perBoard)}`)
      expect((await allowBoardPost(target, now, testDb)).allowed).toBe(true)
    }
    const refused = await allowBoardPost(onBoard('board-new'), now, testDb)
    expect(refused.allowed).toBe(false)
    // Worded for the board and the Kita, not the visitor's network
    expect(refused.message).toContain('in dieser Kita')
    expect(refused.message).not.toContain('Von hier aus')
    // Under a renewed Kita link every board starts afresh
    expect(
      (
        await allowBoardPost(
          onBoard('board-new', 'new-kita-token'),
          now,
          testDb,
        )
      ).allowed,
    ).toBe(true)
  })

  test('a Kita takes more than one board, and far less than its boards', async () => {
    expect(limitOf('note:kita-hour')).toBe(2 * limitOf('note:board-hour'))
    expect(limitOf('note:kita-day')).toBe(2 * limitOf('note:board-day'))
  })
})

describe('allowNoteList', () => {
  test('lets a visitor page through a board without ever noticing it', async () => {
    const client = 'ip4:203.0.113.7'
    for (let i = 0; i < 100; i++) {
      expect(await allowNoteList(client, now)).toBe(true)
    }
  })
})

describe('claimNoteContent', () => {
  const claim = async (board: string, parts: string[]) =>
    claimNoteContent(board, parts, await newNoteId(), now, testDb)

  test('turns the same note away and says so in German', async () => {
    const parts = ['Fahrrad abzugeben', 'Läuft noch prima']
    expect((await claim('board-1', parts)).allowed).toBe(true)
    const again = await claim('board-1', parts)
    expect(again.allowed).toBe(false)
    expect(again.message).toContain('hängt hier schon')
  })

  // Nothing left after normalising means nothing to compare
  test('never calls a note without words a duplicate', async () => {
    expect((await claim('board-1', ['!!!', '???'])).allowed).toBe(true)
    expect((await claim('board-1', ['...', '—'])).allowed).toBe(true)
  })

  test('lets only one of several parallel duplicates through', async () => {
    const parts = ['Suche Kindersitz', 'Für die Gruppe Bienen']
    const results = await Promise.all(
      Array.from({ length: 6 }, () => claim('board-parallel', parts)),
    )
    expect(results.filter((result) => result.allowed)).toHaveLength(1)
  })
})

describe('allowNoteRemoval', () => {
  test('lets a parent take notes down, but not endlessly', async () => {
    const client = 'ip4:203.0.113.7'
    for (let i = 0; i < 30; i++) {
      expect(await allowNoteRemoval(client, now)).toBe(true)
    }
    expect(await allowNoteRemoval(client, now)).toBe(false)
    expect(await allowNoteRemoval('ip4:198.51.100.1', now)).toBe(true)
  })
})

describe('allowSignIn', () => {
  test('limits attempts per account, however many networks ask', async () => {
    const limit = limitOf('auth:sign-in-account')
    for (let i = 0; i < limit; i++) {
      expect((await allowSignIn('leitung@kita.example', now)).allowed).toBe(
        true,
      )
    }
    const refused = await allowSignIn(' Leitung@Kita.example ', now)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    // Another account is unaffected, and two hours later it's open again
    expect((await allowSignIn('andere@kita.example', now)).allowed).toBe(true)
    const later = new Date(now.getTime() + 2 * 60 * 60_000)
    expect((await allowSignIn('leitung@kita.example', later)).allowed).toBe(
      true,
    )
  })
})

describe('allowInvitation', () => {
  const HOUR = 60 * 60_000
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR)

  async function invite(
    kita: string,
    owner: string,
    times: number,
    when = now,
  ) {
    const verdicts = []
    for (let i = 0; i < times; i++) {
      verdicts.push((await allowInvitation(kita, owner, when)).allowed)
    }
    return verdicts
  }

  test('a Kita sends ten invitations an hour and thirty a day', async () => {
    const hourly = limitOf('invite:kita-hour')
    expect(hourly).toBe(10)
    expect(await invite('kita-a', 'owner-a', hourly)).not.toContain(false)
    const refused = await allowInvitation('kita-a', 'owner-a', now)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    expect(refused.retryAfterMs).toBeLessThanOrEqual(HOUR)
    // Another Kita of the same owner has a budget of its own
    expect((await allowInvitation('kita-b', 'owner-a', now)).allowed).toBe(true)

    // The next hours open up again, until the day is used up. The refused
    // attempt above counted too: nine are left in the third hour.
    expect(await invite('kita-a', 'owner-a', hourly, at(1))).not.toContain(
      false,
    )
    const third = await invite('kita-a', 'owner-a', hourly, at(2))
    expect(third.filter(Boolean)).toHaveLength(
      limitOf('invite:kita-day') - 2 * hourly - 1,
    )
    expect((await allowInvitation('kita-a', 'owner-a', at(3))).allowed).toBe(
      false,
    )
  })

  // Spread over Kitas, so that none of them runs out first
  test('an owner sends fifty invitations a day, whatever the Kita', async () => {
    const daily = limitOf('invite:account-day')
    for (let kita = 0; kita < daily / 10; kita++) {
      expect(await invite(`kita-${kita}`, 'owner-a', 10)).not.toContain(false)
    }
    expect((await allowInvitation('kita-new', 'owner-a', now)).allowed).toBe(
      false,
    )
    // Somebody else inviting to the same Kita is not held back by that
    expect((await allowInvitation('kita-new', 'owner-b', now)).allowed).toBe(
      true,
    )
  })
})

describe('allowAuthMail', () => {
  const address = 'kita@example.org'
  const networks = ['203.0.113.1', '203.0.113.2', '203.0.113.3']

  test('limits repeats to one address without blocking it for good', async () => {
    // Two networks, as when the admin asks at work and again at home
    for (let i = 0; i < 5; i++) {
      const request = from(networks[i % 2]!)
      expect(await allowAuthMail(address, 'reset', request, now)).toBe(true)
    }
    expect(await allowAuthMail(address, 'reset', from(networks[2]!), now)).toBe(
      false,
    )
    // Another address is unaffected, and the next hour opens up again
    expect(
      await allowAuthMail(
        'andere@example.org',
        'reset',
        from(networks[0]!),
        now,
      ),
    ).toBe(true)
    const nextHour = new Date(now.getTime() + 60 * 60_000)
    expect(
      await allowAuthMail(address, 'reset', from(networks[0]!), nextHour),
    ).toBe(true)
  })

  test('treats the same address written differently as one recipient', async () => {
    for (let i = 0; i < 5; i++) {
      await allowAuthMail(
        'Kita@Example.org',
        'verification',
        from(networks[i % 2]!),
        now,
      )
    }
    expect(
      await allowAuthMail(
        ' kita@example.org ',
        'verification',
        from(networks[2]!),
        now,
      ),
    ).toBe(false)
  })

  // A flood of reset mails must not hold back the confirmation of an address
  // change for the same account
  test('gives every kind of mail a budget of its own', async () => {
    for (let i = 0; i < 10; i++) {
      await allowAuthMail(address, 'reset', from(networks[i % 3]!), now)
    }
    expect(await allowAuthMail(address, 'reset', from(networks[0]!), now)).toBe(
      false,
    )
    expect(
      await allowAuthMail(address, 'email-change', from(networks[0]!), now),
    ).toBe(true)
    expect(
      await allowAuthMail(address, 'verification', from(networks[0]!), now),
    ).toBe(true)
  })

  // An address can be invited by many Kitas; what it gets is limited all the
  // same, and separately from the mails it asked for itself
  test('limits invitations to one address across Kitas', async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        await allowInvitationMail(address, from(networks[i % 2]!), now),
      ).toEqual({ allowed: true })
    }
    // The owner who asks is told how long to wait
    const refused = await allowInvitationMail(address, from(networks[2]!), now)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    expect(
      await allowAuthMail(address, 'verification', from(networks[2]!), now),
    ).toBe(true)
  })

  // One network alone can't spend what the address has left: after its share
  // it is refused, and its refused attempts cost the address nothing
  test('one network gets only a share of an address', async () => {
    const attacker = from(networks[0]!)
    const results = []
    for (let i = 0; i < 10; i++) {
      results.push(await allowAuthMail(address, 'reset', attacker, now))
    }
    expect(results.filter(Boolean)).toHaveLength(3)
    expect(await allowAuthMail(address, 'reset', from(networks[1]!), now)).toBe(
      true,
    )
    expect(await allowAuthMail(address, 'reset', from(networks[1]!), now)).toBe(
      true,
    )
  })
})

describe('waitLabel', () => {
  test('rounds up to something a person can act on', () => {
    expect(waitLabel(1_000)).toBe('einer Minute')
    expect(waitLabel(4 * 60_000 + 1)).toBe('5 Minuten')
    expect(waitLabel(90 * 60_000)).toBe('2 Stunden')
  })
})
