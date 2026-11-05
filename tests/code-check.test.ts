import { describe, expect, test } from 'bun:test'
import { ref } from 'vue'

import { settleCodeCheck } from '@/lib/code-check'

function form(code: string, error: string | null) {
  return { code: ref(code), error: ref(error) }
}

describe('settleCodeCheck', () => {
  test('clears a rejected code that is still shown, keeping the error', () => {
    const { code, error } = form('123456', 'Der Code ist ungültig.')
    settleCodeCheck(false, error, code, true)
    expect(code.value).toBe('')
    expect(error.value).toBe('Der Code ist ungültig.')
  })

  test('keeps what was typed since, and drops the error about the old code', () => {
    const { code, error } = form('ABCD-EFGH', 'Der Code ist ungültig.')
    settleCodeCheck(false, error, code, false)
    expect(code.value).toBe('ABCD-EFGH')
    expect(error.value).toBeNull()
  })

  test('leaves the form alone after a success', () => {
    const { code, error } = form('123456', null)
    settleCodeCheck(true, error, code, true)
    expect(code.value).toBe('123456')
  })

  test('leaves the code when a call was dropped without an error', () => {
    const { code, error } = form('123456', null)
    settleCodeCheck(false, error, code, true)
    expect(code.value).toBe('123456')
    expect(error.value).toBeNull()
  })
})
