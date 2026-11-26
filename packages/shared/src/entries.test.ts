import { describe, expect, it } from 'vitest'
import {
  bodyMaxLength,
  createEntrySchema,
  entryDateSchema,
  todayIn,
  updateEntrySchema,
} from './index.ts'

describe('002-text-entries: dates and entry input', () => {
  it('AC-6: todayIn gives the day in the time zone, not in UTC', () => {
    const now = new Date('2026-11-26T23:30:00Z')
    expect(todayIn('Europe/Budapest', now)).toBe('2026-11-27')
    expect(todayIn('UTC', now)).toBe('2026-11-26')
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-11-26')
  })

  it('AC-1: todayIn at 21:30 in Budapest is still that day', () => {
    expect(todayIn('Europe/Budapest', new Date('2026-11-26T20:30:00Z'))).toBe('2026-11-26')
  })

  it('AC-7: entryDate must be a real calendar day', () => {
    expect(entryDateSchema.safeParse('2026-02-28').success).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday', '', 20_260_226]) {
      expect(entryDateSchema.safeParse(bad).success, String(bad)).toBe(false)
    }
  })

  it('AC-7: the body is limited to 100 000 characters', () => {
    expect(bodyMaxLength).toBe(100_000)
    expect(createEntrySchema.safeParse({ bodyMd: 'a'.repeat(100_000) }).success).toBe(true)
    expect(createEntrySchema.safeParse({ bodyMd: 'a'.repeat(100_001) }).success).toBe(false)
    expect(updateEntrySchema.safeParse({ bodyMd: 'a'.repeat(100_001) }).success).toBe(false)
  })

  it('AC-7: both fields are optional on create and update', () => {
    expect(createEntrySchema.parse({})).toEqual({})
    expect(updateEntrySchema.parse({ entryDate: '2026-11-26' })).toEqual({
      entryDate: '2026-11-26',
    })
  })
})
