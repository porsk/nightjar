import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.ts'

describe('001-setup-login: passwords', () => {
  it('AC-14: hashes with Argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword({ hash, password: 'correct horse battery' })).toBe(true)
    expect(await verifyPassword({ hash, password: 'wrong' })).toBe(false)
  })
})
