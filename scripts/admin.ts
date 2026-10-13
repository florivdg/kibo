// The operator's tool for a running instance. It talks to Postgres directly,
// like scripts/migrate.mjs, so it needs nothing but DATABASE_URL:
//
//   docker compose exec app node dist/admin.mjs create-user --email … --name …
//   docker compose exec app node dist/admin.mjs subscriptions
//   docker compose exec app node dist/admin.mjs remove-note --id …
//   docker compose exec app node dist/admin.mjs hold-deletion --email … --until …
//   docker compose exec app node dist/admin.mjs delete-kitas --email …
//   bun run admin subscriptions                          (local)
//
// `bun run build` bundles this file to dist/admin.mjs, which is how it gets
// into the image: there is no src/ there, and the rules an account has to
// meet (src/lib/account-rules.ts, src/lib/limits.ts) and the ones a
// subscription follows (src/lib/hosted/) are the ones the app uses, not a
// copy of them. It reads and writes through drizzle with the app's schema
// (src/db/schema/), so a column is named in one place. Packages stay external
// and come from the image's node_modules. Nothing here may import `astro:env`
// — that only exists inside Astro's build — and so nothing that imports
// `@/db` either.
//
// A command is an entry in COMMANDS and a file of its own under
// scripts/admin/.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'

import * as schema from '@/db/schema'
import type { Database } from '@/db/types'
import { errorMessage } from '@/lib/error-message'

import {
  CommandError,
  UsageError,
  type Command,
  type CommandInput,
  type Env,
  type Io,
} from './admin/command'
import { createUserCommand } from './admin/create-user'
import { deleteKitasCommand } from './admin/delete-kitas'
import { holdDeletionCommand } from './admin/hold-deletion'
import { invoiceCommand } from './admin/invoice'
import { kitasCommand } from './admin/kitas'
import { removeNoteCommand } from './admin/remove-note'
import { setFreeCommand } from './admin/set-free'
import { setPaidCommand } from './admin/set-paid'
import { subscriptionsCommand } from './admin/subscriptions'

const PROGRAM = 'node dist/admin.mjs'

// Exit codes: the command failed, or it was called the wrong way
const EXIT_FAILED = 1
const EXIT_USAGE = 2

const PASSWORD_AS_ARGUMENT =
  'Das Passwort wird nicht als Argument übergeben: Argumente stehen in der ' +
  'Prozessliste und in der Shell-History. Es wird abgefragt oder von der ' +
  'Standardeingabe gelesen.'

const COMMANDS: Record<string, Command> = {
  'create-user': createUserCommand,
  subscriptions: subscriptionsCommand,
  kitas: kitasCommand,
  invoice: invoiceCommand,
  'set-paid': setPaidCommand,
  'set-free': setFreeCommand,
  'hold-deletion': holdDeletionCommand,
  'delete-kitas': deleteKitasCommand,
  'remove-note': removeNoteCommand,
}

function commandUsage(name: string, command: Command) {
  const options = Object.entries(command.options)
  const call = options.map(([flag, { value, optional }]) => {
    if (!value) return `[--${flag}]`
    return optional ? `[--${flag} <${value}>]` : `--${flag} <${value}>`
  })
  return [
    [PROGRAM, name, ...call].join(' '),
    ...options.map(([flag, { help }]) => `  --${flag.padEnd(8)}${help}`),
    ...command.notes.map((line) => `  ${line}`),
  ]
}

export function usage() {
  const commands = Object.entries(COMMANDS)
  return [
    `Aufruf: ${PROGRAM} <befehl> [optionen]`,
    '',
    'Befehle:',
    ...commands.map(([name, { summary }]) => `  ${name.padEnd(15)}${summary}`),
    '',
    ...commands.flatMap(([name, command]) => [
      ...commandUsage(name, command),
      '',
    ]),
  ].join('\n')
}

function isPasswordArgument(argument: string) {
  return argument === '--password' || argument.startsWith('--password=')
}

// The options of one command: every one that takes a value given, with a
// value; the flags on or off
function parseOptions(command: Command, args: string[]): CommandInput {
  const options = Object.entries(command.options)
  let parsed: Record<string, string | boolean | undefined>
  try {
    ;({ values: parsed } = parseArgs({
      args,
      options: Object.fromEntries(
        options.map(([name, { value }]) => [
          name,
          { type: value ? ('string' as const) : ('boolean' as const) },
        ]),
      ),
      allowPositionals: false,
    }))
  } catch (error) {
    throw new UsageError(`Ungültige Argumente: ${errorMessage(error)}`)
  }
  const input: CommandInput = { values: {}, flags: {} }
  for (const [name, { value, optional }] of options) {
    const given = parsed[name]
    if (!value) input.flags[name] = given === true
    else if (typeof given === 'string' && given.trim()) {
      input.values[name] = given
    } else if (given !== undefined || !optional) {
      throw new UsageError(`--${name} fehlt`)
    }
  }
  return input
}

// Which command to run and with which options. Throws a UsageError for
// anything that isn't a complete call.
export function parseCommandLine(argv: string[]) {
  const [name, ...args] = argv
  if (!name) throw new UsageError('Kein Befehl angegeben')
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
  if (!command) throw new UsageError(`Unbekannter Befehl: ${name}`)
  if (args.some(isPasswordArgument)) throw new UsageError(PASSWORD_AS_ARGUMENT)
  return { command, ...parseOptions(command, args) }
}

interface Connection {
  db: Database
  close(): Promise<void>
}

// One connection, which is all a command needs: a transaction runs on it
async function connectDatabase(env: Env): Promise<Connection> {
  const url = env.DATABASE_URL?.trim()
  if (!url) throw new CommandError('DATABASE_URL fehlt')
  const client = new Client({ connectionString: url })
  try {
    await client.connect()
  } catch (error) {
    throw new CommandError(`Datenbank nicht erreichbar: ${errorMessage(error)}`)
  }
  return { db: drizzle({ client, schema }), close: () => client.end() }
}

// Runs one call and answers with the exit code. Everything it touches comes
// in from outside, so tests can run whole calls.
export async function run(
  argv: string[],
  {
    io,
    env,
    now = new Date(),
    connect = connectDatabase,
  }: {
    io: Io
    env: Env
    now?: Date
    connect?: (env: Env) => Promise<Connection>
  },
): Promise<number> {
  let connection: Connection | undefined
  try {
    const { command, values, flags } = parseCommandLine(argv)
    connection = await connect(env)
    await command.run({ values, flags }, { db: connection.db, io, env, now })
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`[admin] ${error.message}\n\n${usage()}`)
      return EXIT_USAGE
    }
    const known = error instanceof CommandError
    io.stderr.write(
      `[admin] ${known ? error.message : `Fehlgeschlagen: ${errorMessage(error)}`}\n`,
    )
    return EXIT_FAILED
  } finally {
    await connection?.close()
  }
}

// Run as a program; imported (by tests/admin-script.test.ts) it only provides
// its parts
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  process.exitCode = await run(process.argv.slice(2), {
    io: process,
    env: process.env,
  })
}
