import { describe, expect, it } from 'vitest'
import { createFailedAttempts } from './failed-attempts.ts'

describe('001-setup-login: failed attempts', () => {
  it('AC-11: blocks a key after the maximum and frees it when the window ends', () => {
    let time = 0
    const attempts = createFailedAttempts({ max: 3, windowMs: 1000, now: () => time })
    for (let i = 0; i < 3; i++) {
      expect(attempts.isBlocked('a')).toBe(false)
      attempts.record('a')
    }
    expect(attempts.isBlocked('a')).toBe(true)
    expect(attempts.isBlocked('b')).toBe(false)
    time = 1000
    expect(attempts.isBlocked('a')).toBe(false)
    attempts.record('a')
    expect(attempts.isBlocked('a')).toBe(false)
  })
})
