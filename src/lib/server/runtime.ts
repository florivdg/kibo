import type { Server } from 'node:http'

import { closeDatabase } from '@/db'
import { purgeExpiredNotes } from '@/lib/board/queries'
import { errorMessage } from '@/lib/error-message'
import {
  purgeExpiredSessions,
  purgeExpiredVerifications,
  purgeStaleRateLimits,
} from '@/lib/expired-sessions'
import { startMissingSubscriptions } from '@/lib/hosted/access'
import {
  deleteOwnerlessKitas,
  processSubscriptions,
} from '@/lib/hosted/reminders'
import { storeTermsVersion } from '@/lib/hosted/terms'
import { logInstanceConfiguration } from '@/lib/instance'
import { logOperatorConfiguration } from '@/lib/mail/footer'
import { logMailConfiguration } from '@/lib/mail/mailer'
import { purgeInvitations } from '@/lib/organization-members'
import { logPushConfiguration } from '@/lib/push/config'
import { pushDispatcher } from '@/lib/push/dispatcher'
import { purgeStaleSubscriptions } from '@/lib/push/subscriptions'
import { reportMailer } from '@/lib/reports/outbox'
import { purgeReportCases } from '@/lib/reports/queries'
import { cleanupSpamState } from '@/lib/spam/guard'
import { flushSpamCounts } from '@/lib/spam/metrics'
import { purgeUnverifiedAccounts } from '@/lib/unverified-accounts'

// The one scheduler. Expired notes are hidden from every read immediately and
// deleted for good on this beat; expired sessions, expired verification rows
// (links nobody followed, passkey challenges nobody used), Better Auth's
// rate-limit counters past their window, sign-ups never confirmed,
// invitations that are answered or over, push subscriptions that stopped
// working or that nothing has come of for half a year, reported notes past
// their retention
// (src/lib/reports/queries.ts), the spam counters and the tally of what the
// spam rules did ride along, so there is a single place that knows when
// housekeeping happens.
// On the hosted instance the same run gives every owner of a Kita who has no
// subscription one (src/lib/hosted/access.ts) — with the first run, right at
// start-up, the owners from before HOSTED was switched on —, reminds the
// owners whose trial or paid year ends, deletes the Kitas of the ones who let
// every reminder pass, and the Kitas nobody owns (src/lib/hosted/reminders.ts).
// (Pending push notifications have timers of their own, in
// src/lib/push/dispatcher.ts, and so do the mails about reported notes: they
// go out right after the report, and a sweep every few minutes sends what is
// due again, src/lib/reports/outbox.ts.)
//
// Loaded with the middleware. scripts/server.mjs imports that right after the
// server is up, so this starts with the server rather than with the first
// visitor.
const PURGE_INTERVAL_MS = 60 * 60 * 1000

// How long requests in flight may still finish after SIGTERM. Has to stay well
// below the stop_grace_period of the container (30s in deploy/compose.yml),
// otherwise Docker sends SIGKILL in the middle of the shutdown.
const DRAIN_TIMEOUT_MS = 15_000

// Before anything else, on the hosted instance: the terms and the data
// processing agreement under HOSTED_TERMS_VERSION are stored for good the
// first time the server runs with that version, and a text that differs
// from the stored one stops the start (src/lib/hosted/terms.ts). Awaited at
// the top level, so the module — and with it the middleware, which every
// request needs — fails to load: scripts/server.mjs imports it right after
// starting and exits with the reason, the dev server answers every request
// with it.
await storeTermsVersion()

// One step after the other, so the hourly run holds a single pool connection
// at a time instead of competing with requests for several. Every step logs
// and swallows its own failure, so one that fails doesn't stop the rest.
async function housekeeping() {
  const now = new Date()
  await purgeExpiredNotes(now)
  await purgeUnverifiedAccounts(now)
  await purgeExpiredSessions(now)
  await purgeExpiredVerifications(now)
  await purgeStaleRateLimits(now)
  await purgeInvitations(now)
  await purgeStaleSubscriptions(now)
  await purgeReportCases(now)
  await startMissingSubscriptions(now)
  await processSubscriptions(now)
  await deleteOwnerlessKitas(now)
  await cleanupSpamState(now)
  flushSpamCounts()
}

// unref: the timer alone must not keep the process alive
const purgeTimer = setInterval(
  () => void housekeeping(),
  PURGE_INTERVAL_MS,
).unref()

// scripts/server.mjs starts the standalone server by hand and leaves the
// handle here, because this bundle cannot import that file. Without it (astro
// dev) there is no server to drain, only the pool to close.
function httpServer() {
  const handle: unknown = Reflect.get(globalThis, Symbol.for('kibo.httpServer'))
  return handle && typeof handle === 'object' && 'close' in handle
    ? (handle as Server)
    : undefined
}

// Stops accepting connections and waits for the requests still running. Idle
// keep-alive connections are dropped right away, stubborn ones after the
// drain timeout.
async function drain(server: Server) {
  const closed = new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  server.closeIdleConnections()
  const force = setTimeout(() => server.closeAllConnections(), DRAIN_TIMEOUT_MS)
  try {
    await closed
  } finally {
    clearTimeout(force)
  }
}

let stopping = false

// Docker sends SIGTERM and waits for stop_grace_period: first let the requests
// in flight finish — and the push notifications already on their way, within
// the same time — then close the pool once their queries are done. Pending
// notifications that haven't started yet are dropped. A shutdown that didn't
// get there exits with 1, so it shows up as a failure.
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.info(`[server] ${signal} empfangen, Kibo fährt herunter`)
  clearInterval(purgeTimer)
  pushDispatcher.stop()
  reportMailer.stop()
  let code = 0
  try {
    const server = httpServer()
    await Promise.all([
      server && drain(server),
      pushDispatcher.settle(DRAIN_TIMEOUT_MS),
      reportMailer.settle(DRAIN_TIMEOUT_MS),
    ])
    // Last word before the pool goes: the numbers since the last hour
    flushSpamCounts()
    await closeDatabase()
  } catch (error) {
    code = 1
    console.error(
      `[server] Herunterfahren nicht sauber beendet: ${errorMessage(error)}`,
    )
  }
  process.exit(code)
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

void housekeeping()
reportMailer.start()
logInstanceConfiguration()
logMailConfiguration()
logOperatorConfiguration()
logPushConfiguration()
