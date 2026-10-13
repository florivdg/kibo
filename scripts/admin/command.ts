import type { Database } from '@/db/types'

// What the commands of scripts/admin.ts are made of. A command is an entry
// in COMMANDS there and a file of its own next to this one.

// Called the wrong way: answered with the reason and the usage
export class UsageError extends Error {}

// The command could not do what was asked; the message is for the operator
export class CommandError extends Error {}

export type Env = Record<string, string | undefined>

interface Output {
  write(text: string): unknown
}

// process.stdin, or whatever a test puts in its place
export type Input = NodeJS.ReadableStream & {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

export interface Io {
  stdin: Input
  stdout: Output
  stderr: Output
}

// What every command gets handed, so a test can run one without a process.
// The database is drizzle on the script's one connection, with the schema
// the app uses (src/db/schema/).
export interface CommandContext {
  db: Database
  io: Io
  env: Env
  now: Date
}

interface CommandOption {
  // What stands in for its value in the usage. An option with a value has to
  // be given, unless it is `optional`; one without is a flag, which is off
  // unless it is there.
  value?: string
  optional?: boolean
  help: string
}

// What was given on the command line: the options with a value, and the flags
export interface CommandInput {
  values: Record<string, string>
  flags: Record<string, boolean>
}

export interface Command {
  summary: string
  options: Record<string, CommandOption>
  // Shown under the options in the usage
  notes: string[]
  run(input: CommandInput, context: CommandContext): Promise<void>
}

// Rows under their headings, in columns as wide as their longest entry.
// Numbers stand on the right, where their digits line up.
export function formatTable(headings: string[], rows: (string | number)[][]) {
  const widths = headings.map((heading, column) =>
    Math.max(heading.length, ...rows.map((row) => String(row[column]).length)),
  )
  const numeric = headings.map((_, column) =>
    rows.every((row) => typeof row[column] === 'number'),
  )
  const line = (cells: (string | number)[]) =>
    cells
      .map((cell, column) =>
        numeric[column]
          ? String(cell).padStart(widths[column]!)
          : String(cell).padEnd(widths[column]!),
      )
      .join('  ')
      .trimEnd()
  return [line(headings), ...rows.map(line)].map((text) => `${text}\n`).join('')
}
