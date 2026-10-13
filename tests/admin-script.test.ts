import { randomUUID } from 'node:crypto'
import { PassThrough, Readable } from 'node:stream'

import { verifyPassword } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import { parseCommandLine, run } from '../scripts/admin'
import {
  CommandError,
  formatTable,
  UsageError,
  type Io,
} from '../scripts/admin/command'
import { createUser, readPassword } from '../scripts/admin/create-user'

import {
  account,
  hostedSubscription,
  member,
  note,
  organization,
  reportCase,
  user,
} from '@/db/schema'
import { auth } from '@/lib/auth'
import { addBerlinDays, addDays } from '@/lib/board/time'
import { closeCase } from '@/lib/reports/mutations'

import {
  insertTestNote,
  newOwnedKita,
  newTestBoard,
  removeTestUsers,
} from './helpers/fixtures'
import { casesOf, fileTestReport } from './helpers/reports'
import { testDb } from './helpers/spam-db'

const now = new Date('2026-05-04T10:00:00.000Z')
const PASSWORD = 'richtig-langes-passwort'
const emails: string[] = []
const kitas: string[] = []

// An address no other test or earlier run has used; in mixed case, to see
// that it is stored the way Better Auth stores it
function newEmail(domain = 'example.org') {
  const local = `Admin-Script-${randomUUID()}`
  emails.push(`${local}@${domain}`.toLowerCase())
  return `${local}@${domain}`
}

// What the script printed, and a stdin of the test's choosing
function capture(stdin: Io['stdin'] = Readable.from([])) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    stdin,
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  }
  return { io, out: () => out.join(''), err: () => err.join('') }
}

// A terminal with someone at it: each prompt is answered with the next line
function terminal(answers: string[]) {
  const rawMode: boolean[] = []
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (mode: boolean) => rawMode.push(mode),
  })
  const shown: string[] = []
  const io: Io = {
    stdin,
    stdout: { write: (text) => shown.push(text) },
    stderr: {
      write(text) {
        shown.push(text)
        if (text.endsWith(': ')) stdin.write(answers.shift() ?? '')
      },
    },
  }
  return { io, rawMode, shown: () => shown.join('') }
}

// Why the script refused a call, in its own words; null when it went through
async function refusal(call: Promise<unknown>) {
  try {
    await call
    return null
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    return error.message
  }
}

async function rowsFor(email: string) {
  return testDb
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      twoFactorEnabled: user.twoFactorEnabled,
      accountId: account.accountId,
      providerId: account.providerId,
      password: account.password,
    })
    .from(user)
    .leftJoin(account, eq(account.userId, user.id))
    .where(eq(user.email, email.toLowerCase()))
}

afterAll(async () => {
  await testDb.delete(organization).where(inArray(organization.id, kitas))
  await testDb.delete(user).where(inArray(user.email, emails))
})

describe('parseCommandLine', () => {
  const complete = ['create-user', '--email', 'a@b.de', '--name', 'Anna']

  test('takes a complete call', () => {
    expect(parseCommandLine(complete).values).toEqual({
      email: 'a@b.de',
      name: 'Anna',
    })
    expect(
      parseCommandLine(['create-user', '--name=Anna B.', '--email=a@b.de'])
        .values,
    ).toEqual({ email: 'a@b.de', name: 'Anna B.' })
  })

  test('wants a command it knows', () => {
    expect(() => parseCommandLine([])).toThrow(UsageError)
    expect(() => parseCommandLine([])).toThrow('Kein Befehl angegeben')
    expect(() => parseCommandLine(['delete-everything'])).toThrow(UsageError)
    expect(() => parseCommandLine(['--email', 'a@b.de'])).toThrow(
      'Unbekannter Befehl',
    )
    // Not a command, however much it is a property of every object
    expect(() => parseCommandLine(['constructor'])).toThrow(UsageError)
  })

  // An argument shows up in `ps` and in the shell history
  test('refuses a password on the command line', () => {
    for (const flag of [['--password', 'geheim'], ['--password=geheim']]) {
      expect(() => parseCommandLine([...complete, ...flag])).toThrow(UsageError)
      expect(() => parseCommandLine([...complete, ...flag])).toThrow(
        'nicht als Argument',
      )
    }
  })

  test('names the option that is missing', () => {
    expect(() =>
      parseCommandLine(['create-user', '--email', 'a@b.de']),
    ).toThrow('--name fehlt')
    expect(() => parseCommandLine(['create-user', '--name', 'Anna'])).toThrow(
      '--email fehlt',
    )
    expect(() =>
      parseCommandLine(['create-user', '--email', 'a@b.de', '--name', ' ']),
    ).toThrow('--name fehlt')
  })

  test('refuses options and arguments the command does not have', () => {
    expect(() => parseCommandLine([...complete, '--admin'])).toThrow(UsageError)
    expect(() => parseCommandLine([...complete, 'extra'])).toThrow(UsageError)
  })

  test('takes flags, which are off unless they are given', () => {
    expect(parseCommandLine(['subscriptions'])).toMatchObject({
      values: {},
      flags: { json: false },
    })
    expect(parseCommandLine(['kitas', '--json']).flags).toEqual({ json: true })
    expect(
      parseCommandLine(['set-free', '--revoke', '--email', 'a@b.de']),
    ).toMatchObject({ values: { email: 'a@b.de' }, flags: { revoke: true } })
    expect(parseCommandLine(['set-free', '--email', 'a@b.de']).flags).toEqual({
      revoke: false,
    })
    // A command without flags has none
    expect(parseCommandLine(complete).flags).toEqual({})
  })

  test('a flag takes no value, an option needs one', () => {
    expect(() => parseCommandLine(['subscriptions', '--json=ja'])).toThrow(
      UsageError,
    )
    expect(() => parseCommandLine(['subscriptions', 'json'])).toThrow(
      UsageError,
    )
    expect(() => parseCommandLine(['set-free', '--revoke'])).toThrow(
      '--email fehlt',
    )
    expect(() => parseCommandLine(['set-paid', '--email', 'a@b.de'])).toThrow(
      '--until fehlt',
    )
    expect(() =>
      parseCommandLine(['set-paid', '--until', '2027-01-31']),
    ).toThrow('--email fehlt')
  })
})

describe('formatTable', () => {
  test('lines the columns up, numbers on the right', () => {
    expect(
      formatTable(
        ['E-Mail', 'Kitas', 'Zustand'],
        [
          ['a@kita.example', 4, 'aktiv'],
          ['lange-adresse@kita.example', 12, 'Test'],
        ],
      ),
    ).toBe(
      [
        'E-Mail                      Kitas  Zustand',
        'a@kita.example                  4  aktiv',
        'lange-adresse@kita.example     12  Test',
        '',
      ].join('\n'),
    )
  })
})

describe('readPassword', () => {
  test('reads a piped password without its line ending', async () => {
    const piped = (...chunks: string[]) =>
      readPassword(capture(Readable.from(chunks)).io)
    expect(await piped('geheim-geheim\n')).toBe('geheim-geheim')
    expect(await piped('geheim-geheim\r\n')).toBe('geheim-geheim')
    expect(await piped('geheim-geheim')).toBe('geheim-geheim')
    expect(await piped('geheim-', 'geheim\n')).toBe('geheim-geheim')
  })

  // Only the one line ending a pipe or an editor adds is not the password
  test('keeps everything else as it came', async () => {
    const stdin = Readable.from([' mit leerzeichen und ümläut \n\n'])
    expect(await readPassword(capture(stdin).io)).toBe(
      ' mit leerzeichen und ümläut \n',
    )
    expect(await readPassword(capture().io)).toBe('')
  })

  test('asks twice at a terminal and shows nothing of it', async () => {
    const { io, rawMode, shown } = terminal([
      'geheim-gehex\u007fim\r',
      'geheim-geheim\r',
    ])
    expect(await readPassword(io)).toBe('geheim-geheim')
    expect(shown()).toBe('Passwort: \nPasswort wiederholen: \n')
    // Echo off while typing, back on after each line
    expect(rawMode).toEqual([true, false, true, false])
  })

  test('refuses two entries that differ', async () => {
    const { io } = terminal(['geheim-geheim\r', 'geheim-geheim2\r'])
    expect(await refusal(readPassword(io))).toBe(
      'Die beiden Passwörter stimmen nicht überein',
    )
  })

  test('stops on Ctrl+C and leaves the terminal as it was', async () => {
    const { io, rawMode } = terminal(['geheim\u0003'])
    expect(await refusal(readPassword(io))).toBe('Abgebrochen')
    expect(rawMode).toEqual([true, false])
  })
})

describe('createUser', () => {
  const create = (input: {
    email: string
    name?: string
    password?: string
    env?: Record<string, string | undefined>
  }) =>
    createUser({
      db: testDb,
      name: 'Anna Beispiel',
      password: PASSWORD,
      env: {},
      now,
      ...input,
    })

  test('creates an account that is verified and ready to sign in', async () => {
    const email = newEmail()
    const { id } = await create({ email, name: '  Anna Beispiel ' })

    const rows = await rowsFor(email)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({
      id,
      name: 'Anna Beispiel',
      // Lower case, as Better Auth stores and looks up addresses
      email: email.toLowerCase(),
      emailVerified: true,
      twoFactorEnabled: false,
      accountId: id,
      providerId: 'credential',
    })
    // UTC in a column without a time zone, the way drizzle reads it back
    expect(row?.createdAt).toEqual(now)
    // Better Auth's own hash, never the password
    expect(row?.password).not.toContain(PASSWORD)
    expect(
      await verifyPassword({ hash: row?.password ?? '', password: PASSWORD }),
    ).toBe(true)
  })

  // The real thing: Better Auth takes the account the script wrote
  test('lets the account sign in without confirming a mail', async () => {
    const email = newEmail()
    const { id } = await create({ email })

    const result = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: new Headers(),
    })
    expect(result.user.id).toBe(id)
    expect(result.user.emailVerified).toBe(true)
    expect(result.token).toBeString()

    const wrong: unknown = await auth.api
      .signInEmail({
        body: { email, password: `${PASSWORD}-falsch` },
        headers: new Headers(),
      })
      .catch((error: unknown) => error)
    expect(wrong).toMatchObject({ body: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
  })

  test('refuses an address that already has an account', async () => {
    const email = newEmail()
    await create({ email })
    expect(await refusal(create({ email: email.toUpperCase() }))).toContain(
      'gibt es bereits ein Konto',
    )
    // Nothing of the second attempt stayed behind
    expect(await rowsFor(email)).toHaveLength(1)
  })

  test('applies the password rules of the sign-up', async () => {
    const email = newEmail()
    expect(await refusal(create({ email, password: 'elf-zeichen' }))).toContain(
      'mindestens 12 Zeichen',
    )
    expect(
      await refusal(create({ email, password: 'x'.repeat(129) })),
    ).toContain('höchstens 128 Zeichen')
    expect(await rowsFor(email)).toEqual([])
  })

  test('applies the name rules of the sign-up', async () => {
    const email = newEmail()
    for (const name of [
      'Jetzt gewinnen: https://evil.example',
      'www.evil.example',
      ' ',
      'x'.repeat(81),
      'Anna\nBeispiel',
    ]) {
      expect(await refusal(create({ email, name }))).toContain(
        'Kein gültiger Name',
      )
    }
    expect(await rowsFor(email)).toEqual([])
  })

  test('refuses what is no address', async () => {
    for (const email of [
      'anna',
      'anna@kita',
      'anna@müller.de',
      'a b@kita.de',
    ]) {
      expect(await refusal(create({ email }))).toContain(
        'Keine gültige E-Mail-Adresse',
      )
    }
  })

  describe('with SIGNUP_EMAIL_DOMAINS', () => {
    const env = { SIGNUP_EMAIL_DOMAINS: 'kita-verbund.example, *.kita.example' }

    test('refuses an address outside the list', async () => {
      const email = newEmail('gmail.example')
      expect(await refusal(create({ email, env }))).toContain(
        'steht nicht in SIGNUP_EMAIL_DOMAINS',
      )
      expect(await rowsFor(email)).toEqual([])
    })

    test('takes a listed domain and a subdomain of a wildcard', async () => {
      for (const domain of ['Kita-Verbund.example', 'nord.kita.example']) {
        const email = newEmail(domain)
        await create({ email, env })
        expect(await rowsFor(email)).toHaveLength(1)
      }
    })

    test('does not guess at a list it cannot parse', async () => {
      const email = newEmail()
      expect(
        await refusal(create({ email, env: { SIGNUP_EMAIL_DOMAINS: '*' } })),
      ).toBe('SIGNUP_EMAIL_DOMAINS enthält ungültige Einträge: *')
      expect(await rowsFor(email)).toEqual([])
    })
  })
})

describe('run', () => {
  // The tests' database; the script closes what it opened
  const connect = () => Promise.resolve({ db: testDb, close: async () => {} })
  const never = () => Promise.reject(new Error('nicht erwartet'))

  test('without a command: usage with every command, exit code 2', async () => {
    const { io, out, err } = capture()
    expect(await run([], { io, env: {}, connect: never })).toBe(2)
    expect(err()).toContain('[admin] Kein Befehl angegeben')
    expect(err()).toContain('Befehle:')
    expect(err()).toContain('create-user --email <adresse> --name <name>')
    for (const call of [
      'subscriptions [--json]',
      'kitas [--json]',
      'invoice --email <adresse>',
      'set-paid --email <adresse> --until <JJJJ-MM-TT>',
      'set-free --email <adresse> [--revoke]',
      'remove-note --id <zettel-id>',
    ]) {
      expect(err()).toContain(`node dist/admin.mjs ${call}\n`)
    }
    expect(out()).toBe('')
  })

  test('a password argument: exit code 2, and it is not repeated', async () => {
    const { io, out, err } = capture()
    const argv = ['create-user', '--email', 'a@b.de', '--name', 'Anna']
    expect(
      await run([...argv, '--password', PASSWORD], {
        io,
        env: {},
        connect: never,
      }),
    ).toBe(2)
    expect(err()).toContain('nicht als Argument')
    expect(out() + err()).not.toContain(PASSWORD)
  })

  test('without DATABASE_URL: exit code 1', async () => {
    const { io, err } = capture()
    const argv = ['create-user', '--email', 'a@b.de', '--name', 'Anna']
    expect(await run(argv, { io, env: {} })).toBe(1)
    expect(err()).toBe('[admin] DATABASE_URL fehlt\n')
  })

  test('creates the account from a piped password and never prints it', async () => {
    const email = newEmail()
    const { io, out, err } = capture(Readable.from([`${PASSWORD}\n`]))
    const argv = ['create-user', '--email', email, '--name', 'Anna Beispiel']

    expect(await run(argv, { io, env: {}, now, connect })).toBe(0)

    expect(err()).toBe('')
    expect(out()).toContain(`[admin] Konto für ${email.toLowerCase()} angelegt`)
    expect(out()).not.toContain(PASSWORD)
    const [row] = await rowsFor(email)
    expect(
      await verifyPassword({ hash: row?.password ?? '', password: PASSWORD }),
    ).toBe(true)
  })

  test('a failed command: its reason, exit code 1, no account', async () => {
    const email = newEmail()
    const { io, out, err } = capture(Readable.from(['zu-kurz\n']))
    const argv = ['create-user', '--email', email, '--name', 'Anna Beispiel']

    expect(await run(argv, { io, env: {}, now, connect })).toBe(1)

    expect(err()).toBe(
      '[admin] Das Passwort muss mindestens 12 Zeichen lang sein\n',
    )
    expect(out()).toBe('')
    expect(await rowsFor(email)).toEqual([])
  })

  // Checked before the prompt, so nobody types a password for nothing
  test('turns a bad address away before it reads a password', async () => {
    const stdin = Readable.from([`${PASSWORD}\n`])
    const { io, err } = capture(stdin)
    const argv = ['create-user', '--email', 'keine-adresse', '--name', 'Anna']

    expect(await run(argv, { io, env: {}, now, connect })).toBe(1)

    expect(err()).toContain('Keine gültige E-Mail-Adresse')
    expect(stdin.readableEnded).toBe(false)
  })
})

// subscriptions, kitas, invoice, set-paid and set-free, as whole calls against the
// local PostgreSQL. The lists show every account and Kita of the database —
// the dev server's too — so the tests look for their own rows.
describe('the subscription commands', () => {
  const connect = () => Promise.resolve({ db: testDb, close: async () => {} })

  // A call that went through: what it printed
  async function output(argv: string[], env: Record<string, string> = {}) {
    const { io, out, err } = capture()
    expect([await run(argv, { io, env, now, connect }), err()]).toEqual([0, ''])
    return out()
  }

  // A call that was refused: the exit code and the reason
  async function failure(argv: string[], env: Record<string, string> = {}) {
    const { io, out, err } = capture()
    const code = await run(argv, { io, env, now, connect })
    expect(out()).toBe('')
    return { code, reason: err() }
  }

  // The cells of the table's row that starts with `first`
  function rowOf(table: string, first: string) {
    const line = table.split('\n').find((row) => row.startsWith(`${first} `))
    return line?.split(/ {2,}/)
  }

  async function newOwner() {
    const email = newEmail().toLowerCase()
    const { id } = await createUser({
      db: testDb,
      email,
      name: 'Anna Beispiel',
      password: PASSWORD,
      env: {},
      now,
    })
    return { id, email }
  }

  async function newKita(ownerId: string, name = 'Kita Sonnenschein') {
    const id = `admin-script-${randomUUID()}`
    kitas.push(id)
    await testDb
      .insert(organization)
      .values({ id, name, slug: id, createdAt: now })
    await testDb.insert(member).values({
      id: `admin-script-${randomUUID()}`,
      organizationId: id,
      userId: ownerId,
      role: 'owner',
      createdAt: now,
    })
    return id
  }

  async function subscriptionRow(userId: string) {
    const [row] = await testDb
      .select()
      .from(hostedSubscription)
      .where(eq(hostedSubscription.userId, userId))
    return row
  }

  describe('subscriptions', () => {
    let paying: { id: string; email: string }
    let trying: { id: string; email: string }
    let fresh: { id: string; email: string }
    let free: { id: string; email: string }
    let bystander: { id: string; email: string }

    // What an account that never asked for anything has in the JSON
    const NOTHING_ASKED = {
      invoiceRequestedAt: null,
      billingName: null,
      billingAddress: null,
      billingEmail: null,
      billingReference: null,
      termsVersion: null,
      termsAcceptedAt: null,
      reminderStage: 0,
      deletionNoticeAt: null,
      kitasDeletedAt: null,
      deletionHeldUntil: null,
    }

    beforeAll(async () => {
      // Four Kitas, paid up to the end of the year
      paying = await newOwner()
      for (let i = 0; i < 4; i++) await newKita(paying.id)
      await testDb.insert(hostedSubscription).values({
        userId: paying.id,
        trialEndsAt: new Date('2026-02-01T10:00:00.000Z'),
        paidUntil: new Date('2026-12-31T23:00:00.000Z'),
      })
      // One Kita, in its trial, and waiting for its invoice
      trying = await newOwner()
      await newKita(trying.id)
      await testDb.insert(hostedSubscription).values({
        userId: trying.id,
        trialEndsAt: addDays(now, 10),
        billingName: 'Kita Sonnenschein e. V.',
        billingAddress: 'Musterweg 1\n12345 Musterstadt',
        billingEmail: 'buchhaltung@kita.example',
        billingReference: '991-01234-44',
        invoiceRequestedAt: new Date('2026-05-02T08:00:00.000Z'),
        termsVersion: '2026-10',
        termsAcceptedAt: new Date('2026-04-04T09:00:00.000Z'),
        reminderStage: 1,
      })
      // A Kita from before HOSTED: no subscription yet
      fresh = await newOwner()
      await newKita(fresh.id)
      // Free for good, and no Kita so far
      free = await newOwner()
      await testDb.insert(hostedSubscription).values({
        userId: free.id,
        trialEndsAt: now,
        complimentary: true,
      })
      // Neither a Kita nor a subscription: not the list's business
      bystander = await newOwner()
    })

    test('lists the accounts as a table', async () => {
      const table = await output(['subscriptions'])
      expect(table.split('\n')[0]).toMatch(
        /^E-Mail +Zustand +Testende +Bezahlt bis +Kitas +€\/Jahr +Anfrage$/,
      )
      expect(rowOf(table, paying.email)).toEqual([
        paying.email,
        'aktiv',
        '1. Februar 2026',
        '31. Dezember 2026',
        '4',
        '59',
        '–',
      ])
      // The day the open invoice request came in
      expect(rowOf(table, trying.email)).toEqual([
        trying.email,
        'Test',
        '14. Mai 2026',
        '–',
        '1',
        '49',
        '2. Mai 2026',
      ])
      expect(rowOf(table, fresh.email)).toEqual([
        fresh.email,
        'ohne Eintrag',
        '–',
        '–',
        '1',
        '49',
        '–',
      ])
      expect(rowOf(table, free.email)).toEqual([
        free.email,
        'kostenfrei',
        '4. Mai 2026',
        'unbefristet',
        '0',
        '0',
        '–',
      ])
      expect(rowOf(table, bystander.email)).toBeUndefined()
    })

    test('lists them as JSON', async () => {
      const rows = JSON.parse(
        await output(['subscriptions', '--json']),
      ) as Record<string, unknown>[]
      const entry = (email: string) => rows.find((row) => row.email === email)
      expect(entry(paying.email)).toEqual({
        email: paying.email,
        state: 'active',
        complimentary: false,
        trialEndsAt: '2026-02-01T10:00:00.000Z',
        paidUntil: '2026-12-31T23:00:00.000Z',
        ownedKitas: 4,
        yearlyPriceEur: 59,
        ...NOTHING_ASKED,
      })
      // Where the invoice goes, what was agreed to and how far the reminders
      // got
      expect(entry(trying.email)).toMatchObject({
        state: 'trial',
        paidUntil: null,
        ownedKitas: 1,
        yearlyPriceEur: 49,
        invoiceRequestedAt: '2026-05-02T08:00:00.000Z',
        billingName: 'Kita Sonnenschein e. V.',
        billingAddress: 'Musterweg 1\n12345 Musterstadt',
        billingEmail: 'buchhaltung@kita.example',
        billingReference: '991-01234-44',
        termsVersion: '2026-10',
        termsAcceptedAt: '2026-04-04T09:00:00.000Z',
        reminderStage: 1,
        deletionNoticeAt: null,
        kitasDeletedAt: null,
      })
      expect(entry(fresh.email)).toEqual({
        email: fresh.email,
        state: null,
        complimentary: false,
        trialEndsAt: null,
        paidUntil: null,
        ownedKitas: 1,
        yearlyPriceEur: 49,
        ...NOTHING_ASKED,
      })
      expect(entry(free.email)).toMatchObject({
        state: 'active',
        complimentary: true,
        ownedKitas: 0,
        yearlyPriceEur: 0,
      })
      expect(entry(bystander.email)).toBeUndefined()
    })

    test('the state follows the clock of the call', async () => {
      const { io, out } = capture()
      const later = new Date('2027-01-10T10:00:00.000Z')
      expect(
        await run(['subscriptions'], { io, env: {}, now: later, connect }),
      ).toBe(0)
      expect(rowOf(out(), paying.email)?.[1]).toBe('Kulanz')
      expect(rowOf(out(), trying.email)?.[1]).toBe('löschfällig')
    })

    test('charges what the environment says', async () => {
      const table = await output(['subscriptions'], {
        HOSTED_PRICE_EUR: '100',
        HOSTED_INCLUDED_KITAS: '1',
        HOSTED_EXTRA_KITA_EUR: '20',
      })
      expect(rowOf(table, paying.email)?.at(-2)).toBe('160')
      expect(rowOf(table, trying.email)?.at(-2)).toBe('100')
      expect(rowOf(table, free.email)?.at(-2)).toBe('0')
    })

    test('does not guess at prices it cannot parse', async () => {
      expect(
        await failure(['subscriptions'], {
          HOSTED_PRICE_EUR: 'neunundvierzig',
        }),
      ).toEqual({
        code: 1,
        reason:
          '[admin] HOSTED_PRICE_EUR muss eine ganze Zahl ab 0 sein: "neunundvierzig"\n',
      })
    })
  })

  describe('kitas', () => {
    let owner: { id: string; email: string }
    let name: string
    let kitaId: string
    let orphan: string

    beforeAll(async () => {
      owner = await newOwner()
      name = `Kita Regenbogen ${randomUUID()}`
      kitaId = await newKita(owner.id, name)
      await newTestBoard(kitaId)
      await newTestBoard(kitaId)
      const admin = await newOwner()
      await testDb.insert(member).values({
        id: `admin-script-${randomUUID()}`,
        organizationId: kitaId,
        userId: admin.id,
        role: 'admin',
        createdAt: now,
      })
      await testDb.insert(hostedSubscription).values({
        userId: owner.id,
        trialEndsAt: addDays(now, -20),
      })
      // A Kita nobody owns
      orphan = `Kita Verwaist ${randomUUID()}`
      const id = `admin-script-${randomUUID()}`
      kitas.push(id)
      await testDb
        .insert(organization)
        .values({ id, name: orphan, slug: id, createdAt: now })
    })

    test('lists the Kitas as a table', async () => {
      const table = await output(['kitas'])
      expect(table.split('\n')[0]).toMatch(
        /^Kita +Inhaber:in +Bretter +Mitglieder +Zustand$/,
      )
      expect(rowOf(table, name)).toEqual([
        name,
        owner.email,
        '2',
        '2',
        'pausiert',
      ])
      expect(rowOf(table, orphan)).toEqual([
        orphan,
        '–',
        '0',
        '0',
        'ohne Inhaber:in',
      ])
    })

    test('lists them as JSON', async () => {
      const rows = JSON.parse(await output(['kitas', '--json'])) as Record<
        string,
        unknown
      >[]
      expect(rows.find((row) => row.name === name)).toEqual({
        name,
        slug: kitaId,
        createdAt: now.toISOString(),
        ownerEmail: owner.email,
        boards: 2,
        members: 2,
        state: 'paused',
      })
      expect(rows.find((row) => row.name === orphan)).toMatchObject({
        ownerEmail: null,
        boards: 0,
        members: 0,
        state: null,
      })
    })

    test('a Kita whose owner has no subscription yet says so', async () => {
      const other = await newOwner()
      const otherName = `Kita Neu ${randomUUID()}`
      await newKita(other.id, otherName)
      expect(rowOf(await output(['kitas']), otherName)?.at(-1)).toBe(
        'ohne Eintrag',
      )
      // Looking is all the script does: the app starts the trial
      expect(await subscriptionRow(other.id)).toBeUndefined()
    })
  })

  describe('invoice', () => {
    const billing = {
      billingName: 'Kita Sonnenschein e. V.',
      billingAddress: 'Musterweg 1\n12345 Musterstadt',
      billingEmail: 'buchhaltung@kita.example',
    }

    // The value of a line of the output, by its label
    function field(printed: string, label: string) {
      const line = printed.split('\n').find((row) => row.startsWith(label))
      return line?.slice(line.indexOf(':') + 1).trim()
    }

    test('prints what the invoice of a new subscription needs', async () => {
      const owner = await newOwner()
      const first = `Kita Anton ${randomUUID()}`
      const second = `Kita Berta ${randomUUID()}`
      await newKita(owner.id, second)
      await newKita(owner.id, first)
      await testDb.insert(hostedSubscription).values({
        userId: owner.id,
        trialEndsAt: addDays(now, 10),
        ...billing,
        invoiceRequestedAt: new Date('2026-05-02T08:00:00.000Z'),
      })

      const printed = await output([
        'invoice',
        '--email',
        owner.email.toUpperCase(),
      ])
      // The lines of the mail the operator got, under the day of the request
      expect(printed.split('\n')).toEqual([
        'Anfrage: 2. Mai 2026',
        `Konto: ${owner.email}`,
        'Kitas:',
        `  ${first}`,
        `  ${second}`,
        'Rechnungsempfänger: Kita Sonnenschein e. V.',
        'Rechnungsanschrift:',
        '  Musterweg 1',
        '  12345 Musterstadt',
        'Rechnungs-E-Mail: buchhaltung@kita.example',
        'Jahresbetrag: 49 € (49 € inkl. 3 Kitas)',
        // Never paid: the year starts on the day of the call
        'Zeitraum: 4. Mai 2026 bis 4. Mai 2027',
        `Nach Zahlungseingang: node dist/admin.mjs set-paid --email ${owner.email} --until 2027-05-04`,
        '',
      ])
    })

    test('a renewal follows the year that is paid for', async () => {
      const owner = await newOwner()
      for (let i = 0; i < 5; i++) await newKita(owner.id)
      await testDb.insert(hostedSubscription).values({
        userId: owner.id,
        trialEndsAt: new Date('2025-06-01T10:00:00.000Z'),
        // Paid up to and including 31 December 2026
        paidUntil: new Date('2026-12-31T23:00:00.000Z'),
        ...billing,
      })

      const printed = await output(['invoice', '--email', owner.email], {
        HOSTED_PRICE_EUR: '100',
        HOSTED_EXTRA_KITA_EUR: '20',
      })
      expect(field(printed, 'Anfrage')).toBe('Keine offene Anfrage')
      expect(field(printed, 'Jahresbetrag')).toBe(
        '140 € (100 € inkl. 3 Kitas + 2 × 20 €)',
      )
      expect(field(printed, 'Zeitraum')).toBe(
        '1. Januar 2027 bis 31. Dezember 2027',
      )
      expect(field(printed, 'Nach Zahlungseingang')).toBe(
        `node dist/admin.mjs set-paid --email ${owner.email} --until 2027-12-31`,
      )
      // Reading is all it does
      expect(await subscriptionRow(owner.id)).toMatchObject({
        paidUntil: new Date('2026-12-31T23:00:00.000Z'),
        invoiceRequestedAt: null,
      })
    })

    // Only an account that gave one has the line
    test('prints the Leitweg-ID or order number the invoice has to carry', async () => {
      const owner = await newOwner()
      await newKita(owner.id)
      await testDb.insert(hostedSubscription).values({
        userId: owner.id,
        trialEndsAt: addDays(now, 10),
        ...billing,
        billingReference: '04011000-1234512345-06',
        invoiceRequestedAt: new Date('2026-05-02T08:00:00.000Z'),
      })
      const printed = await output(['invoice', '--email', owner.email])
      const lines = printed.split('\n')
      expect(
        lines.indexOf('Leitweg-ID / Bestellnummer: 04011000-1234512345-06'),
      ).toBe(lines.indexOf('Rechnungs-E-Mail: buchhaltung@kita.example') + 1)
    })

    test('says so when the account has no billing details', async () => {
      const without = await newOwner()
      await newKita(without.id)
      expect(await failure(['invoice', '--email', without.email])).toEqual({
        code: 1,
        reason: `[admin] Für ${without.email} liegen keine Rechnungsdaten vor\n`,
      })
      await testDb.insert(hostedSubscription).values({
        userId: without.id,
        trialEndsAt: addDays(now, 10),
      })
      expect(
        (await failure(['invoice', '--email', without.email])).reason,
      ).toContain('liegen keine Rechnungsdaten vor')
    })

    test('refuses an address without an account, and a call without one', async () => {
      expect(
        await failure(['invoice', '--email', 'niemand@example.org']),
      ).toEqual({
        code: 1,
        reason: '[admin] Kein Konto mit der Adresse niemand@example.org\n',
      })
      const { io, err } = capture()
      expect(await run(['invoice'], { io, env: {}, now, connect })).toBe(2)
      expect(err()).toContain('[admin] --email fehlt')
    })
  })

  describe('set-paid', () => {
    test('creates the subscription of an account that has none', async () => {
      const account = await newOwner()
      const printed = await output([
        'set-paid',
        '--email',
        // As typed, in any case
        account.email.toUpperCase(),
        '--until',
        '2027-05-31',
      ])
      expect(printed).toBe(
        `[admin] ${account.email} ist bezahlt bis einschließlich 31. Mai 2027 (Zustand: aktiv).\n`,
      )
      expect(await subscriptionRow(account.id)).toMatchObject({
        // Midnight in Berlin after the last paid day
        paidUntil: new Date('2027-05-31T22:00:00.000Z'),
        // No trial on top: what counts is the paid period
        trialEndsAt: now,
        complimentary: false,
        invoiceRequestedAt: null,
        reminderStage: 0,
      })
    })

    test('extends a subscription, answers its invoice request and restarts the reminders', async () => {
      const account = await newOwner()
      const trialEndsAt = new Date('2026-03-01T10:00:00.000Z')
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt,
        paidUntil: new Date('2026-03-31T22:00:00.000Z'),
        billingName: 'Kita Sonnenschein e. V.',
        invoiceRequestedAt: new Date('2026-04-20T08:00:00.000Z'),
        termsVersion: '2026-01',
        reminderStage: 4,
        // The deletion was announced, and the Kitas went
        deletionNoticeAt: new Date('2026-04-01T08:00:00.000Z'),
        kitasDeletedAt: new Date('2026-04-16T08:00:00.000Z'),
      })

      await output([
        'set-paid',
        '--email',
        account.email,
        '--until',
        '2027-12-31',
      ])
      expect(await subscriptionRow(account.id)).toMatchObject({
        paidUntil: new Date('2027-12-31T23:00:00.000Z'),
        invoiceRequestedAt: null,
        reminderStage: 0,
        deletionNoticeAt: null,
        kitasDeletedAt: null,
        // Everything else stays as it was
        trialEndsAt,
        billingName: 'Kita Sonnenschein e. V.',
        termsVersion: '2026-01',
        updatedAt: now,
      })
    })

    // The operator's way to end a subscription
    test('takes a date in the past', async () => {
      const account = await newOwner()
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2025-06-01T10:00:00.000Z'),
        paidUntil: new Date('2027-01-31T23:00:00.000Z'),
      })
      expect(
        await output([
          'set-paid',
          '--email',
          account.email,
          '--until',
          '2026-04-01',
        ]),
      ).toBe(
        `[admin] ${account.email} ist bezahlt bis einschließlich 1. April 2026 (Zustand: pausiert).\n`,
      )
    })

    // The same for an account that has no subscription: its row is not
    // given a trial that ends only now, which would be 14 more days of grace
    test('a date in the past ends what an account without a subscription has', async () => {
      const account = await newOwner()
      expect(
        await output([
          'set-paid',
          '--email',
          account.email,
          '--until',
          '2026-04-01',
        ]),
      ).toBe(
        `[admin] ${account.email} ist bezahlt bis einschließlich 1. April 2026 (Zustand: pausiert).\n`,
      )
      const paidUntil = new Date('2026-04-01T22:00:00.000Z')
      expect(await subscriptionRow(account.id)).toMatchObject({
        paidUntil,
        trialEndsAt: paidUntil,
      })
    })

    // A trial that is still running wins, as it does everywhere
    test('a date in the past leaves a running trial alone', async () => {
      const account = await newOwner()
      const trialEndsAt = addDays(now, 10)
      await testDb
        .insert(hostedSubscription)
        .values({ userId: account.id, trialEndsAt })
      expect(
        await output([
          'set-paid',
          '--email',
          account.email,
          '--until',
          '2026-04-01',
        ]),
      ).toContain('(Zustand: Test)')
      expect(await subscriptionRow(account.id)).toMatchObject({
        paidUntil: new Date('2026-04-01T22:00:00.000Z'),
        trialEndsAt,
      })
    })

    test('refuses what is no date, and changes nothing', async () => {
      const account = await newOwner()
      for (const until of ['31.12.2027', '2027-02-30', 'morgen', '2027-1-1']) {
        expect(
          await failure([
            'set-paid',
            '--email',
            account.email,
            '--until',
            until,
          ]),
        ).toEqual({
          code: 1,
          reason: `[admin] --until muss ein Datum der Form JJJJ-MM-TT sein: "${until}"\n`,
        })
      }
      expect(await subscriptionRow(account.id)).toBeUndefined()
    })

    test('refuses an address without an account', async () => {
      expect(
        await failure([
          'set-paid',
          '--email',
          'niemand@admin-script.example',
          '--until',
          '2027-12-31',
        ]),
      ).toEqual({
        code: 1,
        reason:
          '[admin] Kein Konto mit der Adresse niemand@admin-script.example\n',
      })
    })

    test('called without a date: usage, exit code 2', async () => {
      const { code, reason } = await failure(['set-paid', '--email', 'a@b.de'])
      expect(code).toBe(2)
      expect(reason).toStartWith('[admin] --until fehlt\n\nAufruf:')
    })
  })

  describe('set-free', () => {
    test('frees an account for good, with or without a subscription', async () => {
      const account = await newOwner()
      expect(await output(['set-free', '--email', account.email])).toBe(
        `[admin] ${account.email} ist dauerhaft kostenfrei freigeschaltet.\n`,
      )
      expect(await subscriptionRow(account.id)).toMatchObject({
        complimentary: true,
        paidUntil: null,
      })

      // One that ran out long ago: its dates stay, and no longer matter
      const lapsed = await newOwner()
      const trialEndsAt = new Date('2025-01-01T10:00:00.000Z')
      await testDb
        .insert(hostedSubscription)
        .values({ userId: lapsed.id, trialEndsAt })
      await output(['set-free', '--email', lapsed.email])
      // Said twice, it stays what it is
      await output(['set-free', '--email', lapsed.email])
      expect(await subscriptionRow(lapsed.id)).toMatchObject({
        complimentary: true,
        trialEndsAt,
      })
      const table = await output(['subscriptions'])
      expect(rowOf(table, lapsed.email)?.slice(1, 4)).toEqual([
        'kostenfrei',
        '1. Januar 2025',
        'unbefristet',
      ])
    })

    // Never straight into a pause, or the deletion that follows one
    test('--revoke takes it back and leaves a trial to sort things out', async () => {
      const account = await newOwner()
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2025-01-01T10:00:00.000Z'),
        complimentary: true,
        reminderStage: 3,
      })
      expect(
        await output(['set-free', '--email', account.email, '--revoke'], {
          HOSTED_TRIAL_DAYS: '14',
        }),
      ).toBe(
        `[admin] Freischaltung für ${account.email} aufgehoben (Zustand: Test).\n`,
      )
      expect(await subscriptionRow(account.id)).toMatchObject({
        complimentary: false,
        trialEndsAt: addBerlinDays(now, 14),
        reminderStage: 0,
      })
    })

    test('--revoke keeps a paid period and a trial that runs longer', async () => {
      const account = await newOwner()
      const dates = {
        trialEndsAt: addDays(now, 60),
        paidUntil: new Date('2027-12-31T23:00:00.000Z'),
      }
      await testDb
        .insert(hostedSubscription)
        .values({ userId: account.id, ...dates, complimentary: true })
      expect(
        await output(['set-free', '--email', account.email, '--revoke']),
      ).toContain('(Zustand: aktiv)')
      expect(await subscriptionRow(account.id)).toMatchObject({
        ...dates,
        complimentary: false,
      })
    })

    test('--revoke says so when there is nothing to take back', async () => {
      const account = await newOwner()
      const refused = {
        code: 1,
        reason: `[admin] ${account.email} ist nicht freigeschaltet\n`,
      }
      expect(
        await failure(['set-free', '--email', account.email, '--revoke']),
      ).toEqual(refused)
      expect(await subscriptionRow(account.id)).toBeUndefined()

      await testDb
        .insert(hostedSubscription)
        .values({ userId: account.id, trialEndsAt: addDays(now, 5) })
      expect(
        await failure(['set-free', '--email', account.email, '--revoke']),
      ).toEqual(refused)
      expect((await subscriptionRow(account.id))?.trialEndsAt).toEqual(
        addDays(now, 5),
      )
    })

    test('refuses an address without an account', async () => {
      expect(
        await failure(['set-free', '--email', 'niemand@admin-script.example']),
      ).toEqual({
        code: 1,
        reason:
          '[admin] Kein Konto mit der Adresse niemand@admin-script.example\n',
      })
    })
  })

  describe('hold-deletion', () => {
    // Ran out on 1 January: due for deletion, and announced
    async function dueAccount() {
      const account = await newOwner()
      await newKita(account.id)
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2026-01-01T10:00:00.000Z'),
        reminderStage: 4,
        deletionNoticeAt: new Date('2026-04-01T08:00:00.000Z'),
      })
      return account
    }

    test('holds the deletion up to and including the day, and takes the announcement back', async () => {
      const account = await dueAccount()
      expect(
        await output([
          'hold-deletion',
          '--email',
          account.email,
          '--until',
          '2026-06-30',
        ]),
      ).toBe(
        `[admin] Löschung der Kitas von ${account.email} angehalten bis einschließlich 30. Juni 2026 (Zustand: löschfällig, Löschung angehalten bis 30. Juni 2026).\n` +
          '[admin] Eine schon verschickte Ankündigung der Löschung ist zurückgenommen; nach dem Anhalten folgt eine neue.\n',
      )
      const heldUntil = new Date('2026-06-30T22:00:00.000Z')
      expect(await subscriptionRow(account.id)).toMatchObject({
        deletionHeldUntil: heldUntil,
        reminderStage: 3,
        deletionNoticeAt: null,
        updatedAt: now,
      })

      // The lists show it
      expect(rowOf(await output(['subscriptions']), account.email)?.[1]).toBe(
        'löschfällig, Löschung angehalten bis 30. Juni 2026',
      )
      const rows = JSON.parse(
        await output(['subscriptions', '--json']),
      ) as Record<string, unknown>[]
      expect(
        rows.find((row) => row.email === account.email)?.deletionHeldUntil,
      ).toBe('2026-06-30T21:59:59.999Z')

      // --revoke: as usual again
      expect(
        await output(['hold-deletion', '--email', account.email, '--revoke']),
      ).toBe(
        `[admin] Löschung für ${account.email} nicht mehr angehalten (Zustand: löschfällig).\n`,
      )
      expect(await subscriptionRow(account.id)).toMatchObject({
        deletionHeldUntil: null,
        reminderStage: 3,
      })
    })

    test('refuses what is no date before it touches the database', async () => {
      const { io, out, err } = capture()
      // Any query would fail with another reason
      const nowhere = () =>
        Promise.resolve({ db: {} as typeof testDb, close: async () => {} })
      const code = await run(
        ['hold-deletion', '--email', 'a@b.de', '--until', '30.06.2026'],
        { io, env: {}, now, connect: nowhere },
      )
      expect([code, out(), err()]).toEqual([
        1,
        '',
        '[admin] --until muss ein Datum der Form JJJJ-MM-TT sein: "30.06.2026"\n',
      ])
    })

    test('refuses a day that is not after today, before it touches the database', async () => {
      const nowhere = () =>
        Promise.resolve({ db: {} as typeof testDb, close: async () => {} })
      for (const day of ['2026-05-04', '2026-05-03', '2020-01-01']) {
        const { io, out, err } = capture()
        const code = await run(
          ['hold-deletion', '--email', 'a@b.de', '--until', day],
          { io, env: {}, now, connect: nowhere },
        )
        expect([code, out(), err()]).toEqual([
          1,
          '',
          `[admin] --until muss ein Tag nach heute sein: "${day}"\n`,
        ])
      }
    })

    test('--until and --revoke together: usage, exit code 2', async () => {
      const { code, reason } = await failure([
        'hold-deletion',
        '--email',
        'a@b.de',
        '--until',
        '2026-06-30',
        '--revoke',
      ])
      expect(code).toBe(2)
      expect(reason).toStartWith(
        '[admin] --until und --revoke schließen sich aus\n\nAufruf:',
      )
    })

    test('refuses an account whose Kitas are deleted already, and changes nothing', async () => {
      const account = await newOwner()
      await newKita(account.id)
      const row = {
        userId: account.id,
        trialEndsAt: new Date('2026-01-01T10:00:00.000Z'),
        reminderStage: 4,
        deletionNoticeAt: new Date('2026-04-01T08:00:00.000Z'),
        kitasDeletedAt: new Date('2026-04-15T08:00:00.000Z'),
      }
      await testDb.insert(hostedSubscription).values(row)
      expect(
        await failure([
          'hold-deletion',
          '--email',
          account.email,
          '--until',
          '2026-06-30',
        ]),
      ).toEqual({
        code: 1,
        reason: `[admin] Die Kitas von ${account.email} wurden bereits am 15. April 2026 gelöscht; da ist nichts mehr anzuhalten\n`,
      })
      expect(await subscriptionRow(account.id)).toMatchObject({
        ...row,
        deletionHeldUntil: null,
      })
    })

    test('a hold that is over shows nowhere', async () => {
      const account = await newOwner()
      await newKita(account.id)
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2026-01-01T10:00:00.000Z'),
        deletionHeldUntil: new Date('2026-04-30T22:00:00.000Z'),
      })
      expect(rowOf(await output(['subscriptions']), account.email)?.[1]).toBe(
        'löschfällig',
      )
      const rows = JSON.parse(
        await output(['subscriptions', '--json']),
      ) as Record<string, unknown>[]
      expect(
        rows.find((row) => row.email === account.email)?.deletionHeldUntil,
      ).toBeNull()
    })

    test('called without a date and without --revoke: usage, exit code 2', async () => {
      const { code, reason } = await failure([
        'hold-deletion',
        '--email',
        'a@b.de',
      ])
      expect(code).toBe(2)
      expect(reason).toStartWith('[admin] --until fehlt\n\nAufruf:')
      expect(reason).toContain(
        'hold-deletion --email <adresse> [--until <JJJJ-MM-TT>] [--revoke]',
      )
      expect(() =>
        parseCommandLine(['hold-deletion', '--email', 'a@b.de', '--until=']),
      ).toThrow('--until fehlt')
      expect(
        parseCommandLine(['hold-deletion', '--email', 'a@b.de', '--revoke'])
          .values,
      ).toEqual({ email: 'a@b.de' })
    })

    test('refuses an account without a subscription', async () => {
      const account = await newOwner()
      await newKita(account.id)
      const refused = {
        code: 1,
        reason: `[admin] ${account.email} hat keinen Abo-Eintrag; ohne Eintrag wird nichts automatisch gelöscht\n`,
      }
      expect(
        await failure([
          'hold-deletion',
          '--email',
          account.email,
          '--until',
          '2026-06-30',
        ]),
      ).toEqual(refused)
      expect(
        await failure(['hold-deletion', '--email', account.email, '--revoke']),
      ).toEqual(refused)
      expect(await subscriptionRow(account.id)).toBeUndefined()
    })
  })

  describe('delete-kitas', () => {
    async function kitaIds(ids: string[]) {
      const rows = await testDb
        .select({ id: organization.id })
        .from(organization)
        .where(inArray(organization.id, ids))
      return rows.map((row) => row.id)
    }

    test('deletes the Kitas the account owns and prints them', async () => {
      const account = await newOwner()
      const sonne = await newKita(account.id, 'Kita Sonnenschein')
      const regen = await newKita(account.id, 'Kita Regenbogen')
      // One the account only helps to manage stays
      const host = await newOwner()
      const hosted = await newKita(host.id, 'Kita Nachbarn')
      await testDb.insert(member).values({
        id: `admin-script-${randomUUID()}`,
        organizationId: hosted,
        userId: account.id,
        role: 'admin',
        createdAt: now,
      })
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2026-01-01T10:00:00.000Z'),
        deletionHeldUntil: new Date('2026-04-30T22:00:00.000Z'),
      })

      expect(await output(['delete-kitas', '--email', account.email])).toBe(
        `[admin] 2 Kitas von ${account.email} gelöscht:\n` +
          `[admin]   „Kita Regenbogen“ (${regen})\n` +
          `[admin]   „Kita Sonnenschein“ (${sonne})\n`,
      )
      expect(await kitaIds([sonne, regen, hosted])).toEqual([hosted])
      expect(await rowsFor(account.email)).toHaveLength(1)
      expect(await subscriptionRow(account.id)).toMatchObject({
        kitasDeletedAt: now,
        deletionHeldUntil: null,
      })
    })

    // An erasure request during the paid year: the year runs on, and Kitas
    // created later are reminded of and deleted as usual
    test('does not mark a subscription that is still running', async () => {
      const account = await newOwner()
      await newKita(account.id)
      await testDb.insert(hostedSubscription).values({
        userId: account.id,
        trialEndsAt: new Date('2026-01-01T10:00:00.000Z'),
        paidUntil: new Date('2026-12-31T23:00:00.000Z'),
        deletionHeldUntil: new Date('2026-05-31T22:00:00.000Z'),
      })
      await output(['delete-kitas', '--email', account.email])
      expect(await subscriptionRow(account.id)).toMatchObject({
        kitasDeletedAt: null,
        deletionHeldUntil: null,
      })
    })

    test('works without a subscription', async () => {
      const account = await newOwner()
      const kita = await newKita(account.id)
      expect(await output(['delete-kitas', '--email', account.email])).toBe(
        `[admin] 1 Kita von ${account.email} gelöscht:\n` +
          `[admin]   „Kita Sonnenschein“ (${kita})\n`,
      )
      expect(await subscriptionRow(account.id)).toBeUndefined()
    })

    test('refuses an account that owns no Kita, and deletes nothing', async () => {
      const account = await newOwner()
      const host = await newOwner()
      const hosted = await newKita(host.id)
      await testDb.insert(member).values({
        id: `admin-script-${randomUUID()}`,
        organizationId: hosted,
        userId: account.id,
        role: 'admin',
        createdAt: now,
      })
      expect(await failure(['delete-kitas', '--email', account.email])).toEqual(
        {
          code: 1,
          reason: `[admin] ${account.email} gehört keine Kita\n`,
        },
      )
      expect(await kitaIds([hosted])).toEqual([hosted])
    })
  })
})

describe('remove-note', () => {
  const connect = () => Promise.resolve({ db: testDb, close: async () => {} })
  const owners: string[] = []

  afterAll(() => removeTestUsers(...owners))

  async function newReportedNote() {
    const { organizationId, owner } = await newOwnedKita()
    kitas.push(organizationId)
    owners.push(owner.id)
    const target = await newTestBoard(organizationId, { name: 'Igelgruppe' })
    const noteId = await insertTestNote(target.id, { title: 'Böser Zettel' })
    return { organizationId, owner, target, noteId }
  }

  async function call(argv: string[]) {
    const { io, out, err } = capture()
    const code = await run(argv, { io, env: {}, now, connect })
    return { code, out: out(), err: err() }
  }

  function noteRow(id: string) {
    return testDb.select().from(note).where(eq(note.id, id))
  }

  test('takes the note down and closes its open case as removed by the operator', async () => {
    const { organizationId, owner, target, noteId } = await newReportedNote()
    await fileTestReport(target.link, noteId)

    expect(await call(['remove-note', '--id', noteId])).toEqual({
      code: 0,
      out:
        '[admin] Zettel „Böser Zettel“ vom Brett „Igelgruppe“ der Kita „Test-Kita“ entfernt.\n' +
        '[admin] Der offene Meldungsfall der Kita ist als entfernt abgeschlossen.\n',
      err: '',
    })
    expect(await noteRow(noteId)).toEqual([])
    const [closed] = await casesOf(organizationId)
    expect(closed).toMatchObject({
      noteId: null,
      status: 'closed',
      closedAt: now,
      closedBy: null,
      closedByOperator: true,
      resolution: 'removed',
      noteTitle: 'Böser Zettel',
    })
    // The Kita finds the case closed already
    expect(
      await closeCase(
        organizationId,
        closed!.id,
        { userId: owner.id, removeNote: true },
        new Date(),
      ),
    ).toBeUndefined()
  })

  test('a case the Kita closed keeping the note: marked as removed by the operator', async () => {
    const { organizationId, owner, target, noteId } = await newReportedNote()
    await fileTestReport(target.link, noteId)
    const [kept] = await casesOf(organizationId)
    await closeCase(
      organizationId,
      kept!.id,
      { userId: owner.id, removeNote: false },
      new Date(),
    )

    const { code, out } = await call(['remove-note', '--id', noteId])
    expect(code).toBe(0)
    expect(out).toEndWith(
      '[admin] Der von der Kita abgeschlossene Meldungsfall ist jetzt als vom Betreiber entfernt vermerkt.\n',
    )
    expect(await noteRow(noteId)).toEqual([])
    const [found] = await testDb
      .select()
      .from(reportCase)
      .where(eq(reportCase.id, kept!.id))
    expect(found).toMatchObject({
      noteId: null,
      status: 'closed',
      closedAt: now,
      closedBy: null,
      closedByOperator: true,
      resolution: 'removed',
    })
  })

  test('takes down a note nobody reported', async () => {
    const { organizationId, noteId } = await newReportedNote()
    const { code, out } = await call(['remove-note', '--id', noteId])
    expect(code).toBe(0)
    expect(out).toEndWith(
      '[admin] Zu diesem Zettel gab es keinen Meldungsfall.\n',
    )
    expect(await noteRow(noteId)).toEqual([])
    expect(await casesOf(organizationId)).toEqual([])
  })

  test('a note that is gone: its reason, exit code 1', async () => {
    const { noteId } = await newReportedNote()
    await testDb.delete(note).where(eq(note.id, noteId))
    expect(await call(['remove-note', '--id', noteId])).toEqual({
      code: 1,
      out: '',
      err: `[admin] Kein Zettel mit der Kennung ${noteId} – schon abgenommen oder abgelaufen\n`,
    })
  })

  test('called without an id: usage, exit code 2', async () => {
    for (const argv of [['remove-note'], ['remove-note', '--id', ' ']]) {
      const { code, err } = await call(argv)
      expect(code).toBe(2)
      expect(err).toStartWith('[admin] --id fehlt\n\nAufruf:')
    }
  })

  test('an id that is no UUID: refused before any query, exit code 1', async () => {
    // Any use of the database would throw, and say so in the output
    const untouchable = new Proxy(testDb, {
      get() {
        throw new Error('Datenbank benutzt')
      },
    })
    const { io, out, err } = capture()
    const code = await run(['remove-note', '--id', "1' OR '1'='1"], {
      io,
      env: {},
      now,
      connect: () =>
        Promise.resolve({ db: untouchable, close: async () => {} }),
    })
    expect({ code, out: out(), err: err() }).toEqual({
      code: 1,
      out: '',
      err: "[admin] Keine gültige Zettel-ID: 1' OR '1'='1\n",
    })
  })
})
