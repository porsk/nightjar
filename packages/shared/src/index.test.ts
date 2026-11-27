import { describe, expect, it } from 'vitest'
import {
  healthResponseSchema,
  readyResponseSchema,
  setupAccountSchema,
  setupRequestSchema,
  timeZoneSchema,
} from './index.ts'

describe('healthResponseSchema', () => {
  it('accepts an ok status', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' })
  })

  it('rejects any other status', () => {
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false)
  })
})

describe('readyResponseSchema', () => {
  it('accepts ok, starting and db_down', () => {
    for (const status of ['ok', 'starting', 'db_down']) {
      expect(readyResponseSchema.parse({ status })).toEqual({ status })
    }
  })

  it('rejects any other status', () => {
    expect(readyResponseSchema.safeParse({ status: 'maybe' }).success).toBe(false)
  })
})

describe('001-setup-login: setup schemas', () => {
  const account = {
    setupCode: 'ABCD2345',
    username: 'owner.name',
    name: 'Örs',
    password: '12345678',
  }

  it('AC-2: accepts a code, a username, a name and a password of 8 characters', () => {
    expect(setupAccountSchema.safeParse(account).success).toBe(true)
  })

  it.each([
    ['an empty code', { setupCode: '  ' }],
    ['a username of 2 characters', { username: 'ab' }],
    ['a username of 33 characters', { username: 'a'.repeat(33) }],
    ['a username with a space', { username: 'owner name' }],
    ['a username with an accent', { username: 'örs' }],
    ['an email as username', { username: 'a@b.hu' }],
    ['an empty name', { name: '  ' }],
    ['a name of 61 characters', { name: 'x'.repeat(61) }],
    ['a password of 7 characters', { password: '1234567' }],
  ])('AC-2: rejects %s', (_name, change) => {
    expect(setupAccountSchema.safeParse({ ...account, ...change }).success).toBe(false)
  })

  it('AC-20: a username is trimmed and lowercased, a name keeps its accents', () => {
    const parsed = setupAccountSchema.parse({
      ...account,
      username: ' Owner.Name_1-x ',
      name: ' Árvíztűrő ',
    })
    expect(parsed).toMatchObject({ username: 'owner.name_1-x', name: 'Árvíztűrő' })
  })

  it('AC-4: the full request needs a language, a real IANA time zone and the transcription choice', () => {
    const request = {
      ...account,
      uiLanguage: 'hu',
      timeZone: 'Europe/Budapest',
      transcriptionEnabled: false,
    }
    expect(setupRequestSchema.safeParse(request).success).toBe(true)
    expect(setupRequestSchema.safeParse({ ...request, timeZone: 'Mars/Base' }).success).toBe(false)
    expect(setupRequestSchema.safeParse({ ...request, uiLanguage: 'de' }).success).toBe(false)
    expect(timeZoneSchema.safeParse('UTC').success).toBe(true)
  })
})
