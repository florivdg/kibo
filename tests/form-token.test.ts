import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'

import { notes } from '@/actions/notes'
import { formTokens } from '@/lib/board/form-token-client'
import type { BoardLink } from '@/lib/board/types'
import {
  NOTE_FORM_TOKEN_MAX_AGE_MS,
  NOTE_FORM_TOKEN_MIN_AGE_MS,
} from '@/lib/limits'
import { pushDispatcher } from '@/lib/push/dispatcher'
import * as formToken from '@/lib/spam/form-token'
import { isValidFormToken, issueFormToken } from '@/lib/spam/form-token'
import { allowNoteFormToken, issueNoteFormToken } from '@/lib/spam/guard'
import * as metrics from '@/lib/spam/metrics'

import { refusal, visitorContext } from './helpers/actions'
import { newTestBoard, newTestKita, removeTestKitas } from './helpers/fixtures'
import { noteDraft, ripeFormToken } from './helpers/note-draft'
import { newProcess, resetSpamCounters, rotateKey } from './helpers/spam-db'

// The form token a note is pinned with (src/lib/spam/form-token.ts): issued
// by notes.formToken, taken by notes.create between three seconds and two
// hours after, for its own board only — and the composer's side of it.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

let organizationId: string
let link: BoardLink
let otherBoard: BoardLink
let visitors = 0
let schedule: ReturnType<typeof spyOn>

// Every request from a network of its own, so no budget is in the way
function visitor() {
  visitors += 1
  return visitorContext(`192.0.2.${visitors}`)
}

// No token: the field undefined, as if a script had left it out
const pin = async (formToken?: string, title = 'Laternenfest') =>
  refusal(
    notes.create.orThrow.call(
      visitor(),
      await noteDraft(link, { formToken, title }),
    ),
  )

const ago = (ms: number) => new Date(Date.now() - ms)

beforeAll(async () => {
  organizationId = await newTestKita()
  link = (await newTestBoard(organizationId)).link
  otherBoard = (await newTestBoard(organizationId)).link
})

beforeEach(async () => {
  visitors = 0
  await resetSpamCounters()
  // The notifications the notes schedule are none of these tests' business
  schedule = spyOn(pushDispatcher, 'schedule').mockImplementation(() => {})
})

afterEach(() => {
  schedule.mockRestore()
})

afterAll(async () => {
  await removeTestKitas(organizationId)
})

describe('notes.formToken', () => {
  test('hands out a token that pins a note once it has ripened', async () => {
    const { token } = await notes.formToken.orThrow.call(visitor(), link)
    expect(await allowNoteFormToken(token, link.boardId)).toEqual({
      allowed: false,
    })
    const ripe = new Date(Date.now() + NOTE_FORM_TOKEN_MIN_AGE_MS + SECOND)
    expect(await allowNoteFormToken(token, link.boardId, ripe)).toEqual({
      allowed: true,
    })
  })

  test('only for a board behind the link', async () => {
    expect(
      await refusal(
        notes.formToken.orThrow.call(visitor(), {
          ...link,
          boardId: 'unbekannt',
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' })
  })

  test('costs what paging costs', async () => {
    const context = visitorContext('192.0.2.200')
    for (let i = 0; i < 120; i++) {
      await notes.formToken.orThrow.call(context, link)
    }
    expect(
      await refusal(notes.formToken.orThrow.call(context, link)),
    ).toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })
})

describe('notes.formToken without the keys', () => {
  test('words the refusal and counts it as unavailable', async () => {
    const issue = spyOn(formToken, 'issueFormToken').mockRejectedValue(
      new Error('Datenbank weg'),
    )
    const logged = spyOn(console, 'error').mockImplementation(() => {})
    const counted = spyOn(metrics, 'countSpamEvent')
    try {
      expect(
        await refusal(notes.formToken.orThrow.call(visitor(), link)),
      ).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringContaining('gerade nicht prüfen'),
      })
      expect(counted).toHaveBeenCalledWith('note:unavailable')
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      issue.mockRestore()
      logged.mockRestore()
      counted.mockRestore()
    }
  })
})

describe('notes.create with a form token', () => {
  const BAD = { code: 'BAD_REQUEST', status: 400 }

  test('takes a ripe token of its board', async () => {
    expect(await pin(await ripeFormToken(link.boardId))).toBeNull()
  })

  test('refuses a note without a token, like any invalid input', async () => {
    for (const token of [undefined, '', 'kein-token']) {
      const refused = await pin(token)
      expect(refused).toMatchObject(BAD)
      // Nothing names the field
      expect(refused?.message).not.toContain('formToken')
    }
  })

  test('refuses a token sent right after it was issued', async () => {
    const token = await issueNoteFormToken(link.boardId)
    expect(await pin(token)).toMatchObject(BAD)
  })

  test('refuses a token older than two hours', async () => {
    const token = await issueNoteFormToken(
      link.boardId,
      ago(NOTE_FORM_TOKEN_MAX_AGE_MS + SECOND),
    )
    expect(await pin(token)).toMatchObject(BAD)
    // Just inside it is fine
    const late = await issueNoteFormToken(
      link.boardId,
      ago(NOTE_FORM_TOKEN_MAX_AGE_MS - MINUTE),
    )
    expect(await pin(late, 'Spät, aber gut')).toBeNull()
  })

  test("refuses another board's token", async () => {
    expect(await pin(await ripeFormToken(otherBoard.boardId))).toMatchObject(
      BAD,
    )
  })

  test('refuses a token that was changed', async () => {
    const token = await ripeFormToken(link.boardId)
    const [key, issuedAt, nonce, signature] = token.split('.') as [
      string,
      string,
      string,
      string,
    ]
    // Made older, to look ripe sooner; another nonce; another signature; a
    // key that doesn't exist; no key at all
    const flipped = signature.startsWith('A') ? 'B' : 'A'
    const madeUp = Buffer.from('erfunden').toString('base64url')
    for (const changed of [
      `${key}.${Number(issuedAt) - MINUTE}.${nonce}.${signature}`,
      `${key}.${issuedAt}.${'x'.repeat(16)}.${signature}`,
      `${key}.${issuedAt}.${nonce}.${flipped}${signature.slice(1)}`,
      `${madeUp}.${issuedAt}.${nonce}.${signature}`,
      `${issuedAt}.${nonce}.${signature}`,
    ]) {
      expect(await pin(changed)).toMatchObject(BAD)
    }
  })

  // A key that is rotated out keeps verifying for as long as it keeps
  // counting, far longer than a token lives. Two stores of their own stand in
  // for the app before and after the rotation: the app's own caches its keys,
  // and the other test files rotate and delete keys underneath it.
  test('a token signed before a key rotation still verifies', async () => {
    const before = newProcess()
    const token = await issueFormToken(
      before,
      link.boardId,
      ago(NOTE_FORM_TOKEN_MIN_AGE_MS + SECOND),
    )
    await rotateKey()
    const after = newProcess()
    expect(await isValidFormToken(after, token, link.boardId, new Date())).toBe(
      true,
    )
    // One issued now is signed with the new key, which the old store finds
    // as well once it looks again
    const issued = new Date()
    const fresh = await issueFormToken(after, link.boardId, issued)
    const ripe = new Date(issued.getTime() + NOTE_FORM_TOKEN_MIN_AGE_MS)
    expect(await isValidFormToken(before, fresh, link.boardId, ripe)).toBe(true)
    expect(await isValidFormToken(after, fresh, otherBoard.boardId, ripe)).toBe(
      false,
    )
  })
})

// The composer's side, with a clock of its own and no waiting
describe('formTokens', () => {
  // Lets the fetch that prepare() started arrive
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

  // `overslept`: how much longer than asked each sleep takes, in turn — a
  // device that went to sleep with the composer open
  function setUp(
    answers: { data?: { token: string }; error?: string }[],
    overslept: number[] = [],
  ) {
    let now = 1_000_000
    const slept: number[] = []
    let fetched = 0
    const tokens = formTokens<string>(
      async () => answers[fetched++] ?? { data: { token: `t${fetched}` } },
      {
        clock: () => now,
        sleep: async (ms) => {
          slept.push(ms)
          now += ms + (overslept.shift() ?? 0)
        },
      },
    )
    return {
      tokens,
      slept,
      fetches: () => fetched,
      pass: (ms: number) => (now += ms),
    }
  }

  test('fetches on opening and hands the token out once it has ripened', async () => {
    const { tokens, slept, fetches, pass } = setUp([])
    tokens.prepare()
    await settled()
    pass(MINUTE)
    expect(await tokens.ready()).toEqual({ token: 't1' })
    expect(slept).toEqual([])
    // Opening again keeps a token that is still good
    tokens.prepare()
    expect(await tokens.ready()).toEqual({ token: 't1' })
    expect(fetches()).toBe(1)
  })

  test('waits out the three seconds of a fast visitor', async () => {
    const { tokens, slept, pass } = setUp([])
    tokens.prepare()
    await settled()
    pass(SECOND)
    expect(await tokens.ready()).toEqual({ token: 't1' })
    expect(slept).toEqual([NOTE_FORM_TOKEN_MIN_AGE_MS - SECOND])
  })

  test('replaces a token left open too long before sending it', async () => {
    const { tokens, slept, fetches, pass } = setUp([])
    tokens.prepare()
    await settled()
    pass(NOTE_FORM_TOKEN_MAX_AGE_MS - 5 * MINUTE)
    expect(await tokens.ready()).toEqual({ token: 't2' })
    expect(fetches()).toBe(2)
    // A fresh one has to ripen as well
    expect(slept).toEqual([NOTE_FORM_TOKEN_MIN_AGE_MS])
  })

  test('replaces a token that went stale while the device slept', async () => {
    const { tokens, slept, fetches, pass } = setUp([], [3 * HOUR])
    tokens.prepare()
    await settled()
    pass(SECOND)
    expect(await tokens.ready()).toEqual({ token: 't2' })
    expect(fetches()).toBe(2)
    expect(slept).toEqual([
      NOTE_FORM_TOKEN_MIN_AGE_MS - SECOND,
      NOTE_FORM_TOKEN_MIN_AGE_MS,
    ])
  })

  test('a clock set back costs a new token, not an hour of waiting', async () => {
    const { tokens, slept, fetches, pass } = setUp([])
    tokens.prepare()
    await settled()
    pass(-HOUR)
    expect(await tokens.ready()).toEqual({ token: 't2' })
    expect(fetches()).toBe(2)
    expect(slept).toEqual([NOTE_FORM_TOKEN_MIN_AGE_MS])
  })

  test('fetches a new token after a refused one was discarded', async () => {
    const { tokens, fetches, pass } = setUp([])
    tokens.prepare()
    await settled()
    pass(MINUTE)
    expect(await tokens.ready()).toEqual({ token: 't1' })
    tokens.discard()
    expect(await tokens.ready()).toEqual({ token: 't2' })
    expect(fetches()).toBe(2)
  })

  test('hands on why there is no token, and asks again next time', async () => {
    const { tokens, fetches } = setUp([{ error: 'NOT_FOUND' }])
    tokens.prepare()
    expect(await tokens.ready()).toEqual({ error: 'NOT_FOUND' })
    expect(fetches()).toBe(1)
    expect(await tokens.ready()).toEqual({ token: 't2' })
  })
})
