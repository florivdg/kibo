import { describe, expect, test } from 'bun:test'
import { DrizzleQueryError } from 'drizzle-orm'

import { pushSubscription } from '@/db/schema'
import { errorMessage } from '@/lib/error-message'

import { testDb } from './helpers/spam-db'

describe('errorMessage', () => {
  test('keeps the statement of a failed query, never its parameters', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/geheim-123'
    let failed: unknown
    try {
      // No such board: the foreign key fails, with the endpoint as parameter
      await testDb.insert(pushSubscription).values({
        boardId: 'gibt-es-nicht',
        endpoint,
        p256dh: 'schluessel-p256dh',
        auth: 'schluessel-auth',
      })
    } catch (error) {
      failed = error
    }
    expect(failed).toBeInstanceOf(DrizzleQueryError)
    const message = errorMessage(failed)
    expect(message).toStartWith('Failed query: insert into "push_subscription"')
    for (const secret of ['geheim-123', 'schluessel', 'params']) {
      expect(message).not.toContain(secret)
    }
  })

  test('leaves other messages alone', () => {
    expect(errorMessage(new Error('Verbindung abgebrochen'))).toBe(
      'Verbindung abgebrochen',
    )
    expect(errorMessage('kein Error')).toBe('unbekannter Fehler')
  })
})
