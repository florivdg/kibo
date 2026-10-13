import { generateId } from '@better-auth/core/utils/id'
import { z } from 'astro/zod'
import { hashPassword } from 'better-auth/crypto'

import { account, user } from '@/db/schema'
import type { Database } from '@/db/types'
import { assertAccountName } from '@/lib/account-rules'
import { normalizeEmail } from '@/lib/email'
import {
  ACCOUNT_NAME_MAX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@/lib/limits'

import {
  invalidEmailDomainsProblem,
  isEmailDomainAllowed,
  parseEmailDomains,
} from '../instance-config.mjs'
import {
  CommandError,
  type Command,
  type Env,
  type Input,
  type Io,
} from './command'

const ENTER = new Set(['\r', '\n', '\u0004'])
const BACKSPACE = new Set(['\u007f', '\b'])
const CTRL_C = '\u0003'
const ESCAPE = '\u001b'

// One line typed at the terminal without showing it. Raw mode hands over
// every key, so Enter, Backspace and Ctrl+C are handled here.
function promptHidden({ stdin, stderr }: Io, label: string) {
  stderr.write(label)
  return new Promise<string>((done, fail) => {
    const typed: string[] = []

    function finish(settle: () => void) {
      stdin.off('data', onData)
      stdin.setRawMode?.(false)
      stdin.pause()
      stderr.write('\n')
      settle()
    }

    function onData(chunk: string | Buffer) {
      const text = chunk.toString()
      // An arrow or function key, not something typed into a password
      if (text.startsWith(ESCAPE)) return
      for (const key of text) {
        if (ENTER.has(key)) return finish(() => done(typed.join('')))
        if (key === CTRL_C) {
          return finish(() => fail(new CommandError('Abgebrochen')))
        }
        if (BACKSPACE.has(key)) typed.pop()
        else typed.push(key)
      }
    }

    stdin.setRawMode?.(true)
    stdin.on('data', onData)
    stdin.resume()
  })
}

// Everything up to the end of a pipe or a file, minus the one line ending
// that `echo` and editors add
async function readPiped(stdin: Input) {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '')
}

// The password never arrives as an argument and is never printed. At a
// terminal it is typed twice, hidden; piped in, standard input is the password.
export async function readPassword(io: Io): Promise<string> {
  if (!io.stdin.isTTY) return readPiped(io.stdin)
  const password = await promptHidden(io, 'Passwort: ')
  const repeated = await promptHidden(io, 'Passwort wiederholen: ')
  if (password !== repeated) {
    throw new CommandError('Die beiden Passwörter stimmen nicht überein')
  }
  return password
}

// SIGNUP_EMAIL_DOMAINS holds for accounts made here as well, so there is one
// rule for who gets an account. Overriding it for one call is the operator's
// decision: `docker compose exec -e SIGNUP_EMAIL_DOMAINS= …`.
function checkEmailDomain(email: string, env: Env) {
  const { domains, invalid } = parseEmailDomains(env.SIGNUP_EMAIL_DOMAINS)
  if (invalid.length) {
    throw new CommandError(invalidEmailDomainsProblem(invalid))
  }
  if (!isEmailDomainAllowed(email, domains)) {
    throw new CommandError(
      `Die Domain von ${email} steht nicht in SIGNUP_EMAIL_DOMAINS (${domains.join(', ')})`,
    )
  }
}

// Address and name as the sign-up would take them, in the form they are
// stored: Better Auth checks addresses with the same z.email() and keeps them
// in lower case.
function checkAccount(input: { email: string; name: string }, env: Env) {
  const email = normalizeEmail(input.email)
  if (!z.email().safeParse(email).success) {
    throw new CommandError(`Keine gültige E-Mail-Adresse: ${input.email}`)
  }
  checkEmailDomain(email, env)
  try {
    assertAccountName(input.name)
  } catch {
    throw new CommandError(
      `Kein gültiger Name (eine Zeile, höchstens ${ACCOUNT_NAME_MAX} Zeichen, ohne Links)`,
    )
  }
  return { email, name: input.name.trim() }
}

// Better Auth's own bounds (minPasswordLength and maxPasswordLength in
// src/lib/auth-options.ts), counted the way it counts
function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new CommandError(
      `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein`,
    )
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new CommandError(
      `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein`,
    )
  }
}

// Postgres' code for a unique constraint, here the one on "user".email.
// drizzle wraps the driver's error, so the code is looked for in the causes.
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueViolation(error.cause)
}

// The two rows Better Auth's sign-up writes, with the address already
// confirmed: the user, and the credential account that holds the password
// hash (its own scrypt, from better-auth/crypto). Both or neither.
function insertAccount(
  db: Database,
  created: { id: string; email: string; name: string; hash: string },
  now: Date,
) {
  return db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: created.id,
      name: created.name,
      email: created.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: false,
    })
    await tx.insert(account).values({
      id: generateId(),
      accountId: created.id,
      providerId: 'credential',
      userId: created.id,
      password: created.hash,
      createdAt: now,
      updatedAt: now,
    })
  })
}

// An account that can sign in right away: same rules for name, address and
// password as the sign-up, no confirmation mail. For SIGNUP_MODE=closed,
// where nobody can create one themselves.
export async function createUser(input: {
  db: Database
  email: string
  name: string
  password: string
  env: Env
  now: Date
}): Promise<{ id: string; email: string }> {
  const { email, name } = checkAccount(input, input.env)
  checkPassword(input.password)
  const id = generateId()
  const hash = await hashPassword(input.password)
  try {
    await insertAccount(input.db, { id, email, name, hash }, input.now)
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new CommandError(`Für ${email} gibt es bereits ein Konto`)
  }
  return { id, email }
}

export const createUserCommand: Command = {
  summary: 'Legt ein Konto mit bestätigter E-Mail-Adresse an',
  options: {
    email: { value: 'adresse', help: 'E-Mail-Adresse des Kontos' },
    name: { value: 'name', help: 'Name der Person, steht in den E-Mails' },
  },
  notes: [
    'Das Passwort wird zweimal verdeckt abgefragt. Ohne Terminal wird es von',
    'der Standardeingabe gelesen (eine Zeile aus einer Datei oder einer Pipe),',
    'nie als Argument übergeben.',
  ],
  async run({ values: { email = '', name = '' } }, { db, io, env, now }) {
    // Before the prompt, so nobody types a password for an address that
    // isn't taken anyway
    checkAccount({ email, name }, env)
    const password = await readPassword(io)
    const created = await createUser({ db, email, name, password, env, now })
    io.stdout.write(
      `[admin] Konto für ${created.email} angelegt (${created.id}). ` +
        'Die Adresse gilt als bestätigt, die Anmeldung ist sofort möglich.\n',
    )
  },
}
