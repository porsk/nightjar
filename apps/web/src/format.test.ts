import { describe, expect, it } from 'vitest'
import { formatDate, formatDuration, formatSize, formatTime, formatTimer } from './format.ts'

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

describe('003-voice-entries: durations and sizes', () => {
  it('AC-1: the timer shows minutes and seconds with two digits', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(134_900)).toBe('02:14')
    expect(formatTimer(3_600_000)).toBe('60:00')
  })

  it('AC-19: the player shows position and length as m:ss', () => {
    expect(formatDuration(46_400)).toBe('0:46')
    expect(formatDuration(108_000)).toBe('1:48')
  })

  it('AC-8: the upload card shows the size in the language of the app', () => {
    expect(formatSize(3_200_000, 'en')).toBe('3.2 MB')
    expect(formatSize(3_200_000, 'hu')).toBe('3,2 MB')
  })
})
