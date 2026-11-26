import { describe, expect, it } from 'vitest'
import { formatDate, formatTime } from './format.ts'

const at = new Date('2026-11-26T20:30:00Z')
const plain = (text: string) => text.normalize('NFKC')

describe('006-settings: date and time formatting', () => {
  it('AC-7: formats the date and time in Hungarian', () => {
    expect(formatDate(at, 'hu', 'Europe/Budapest')).toBe('2026. november 26., csütörtök')
    expect(plain(formatTime(at, 'hu', 'Europe/Budapest'))).toBe('21:30')
  })

  it('AC-7: formats the date and time in English', () => {
    expect(formatDate(at, 'en', 'Europe/Budapest')).toBe('Thursday, November 26, 2026')
    expect(plain(formatTime(new Date('2026-11-26T21:30:00Z'), 'en', 'UTC'))).toBe('9:30 PM')
  })

  it('AC-3: the same moment lands on another day in another time zone', () => {
    const lateEvening = new Date('2026-11-26T23:30:00Z')
    expect(formatDate(lateEvening, 'en', 'Europe/Budapest')).toBe('Friday, November 27, 2026')
    expect(formatDate(lateEvening, 'en', 'America/New_York')).toBe('Thursday, November 26, 2026')
    expect(plain(formatTime(at, 'en', 'America/New_York'))).toBe('3:30 PM')
  })
})
