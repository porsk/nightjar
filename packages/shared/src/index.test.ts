import { describe, expect, it } from 'vitest'
import { healthResponseSchema, readyResponseSchema } from './index.ts'

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
