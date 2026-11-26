import i18n from 'i18next'
import { beforeEach, describe, expect, it } from 'vitest'
import { dayHeading } from './dates.ts'
import { formatDuration, greetingPeriod } from './format.ts'
import './i18n/index.ts'

describe('004-timeline: day headings, lengths and greetings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  const headings = async (language: 'hu' | 'en', days: string[]) => {
    await i18n.changeLanguage(language)
    return days.map((day) => dayHeading(day, '2026-11-26', language, i18n.t))
  }

  it('AC-2: Hungarian headings name today, yesterday, then weekday and date, with the year for other years', async () => {
    expect(await headings('hu', ['2026-11-26', '2026-11-25', '2026-11-23', '2025-12-05'])).toEqual([
      'Ma, november 26.',
      'Tegnap, november 25.',
      'Hétfő, november 23.',
      'Péntek, 2025. december 5.',
    ])
  })

  it('AC-2: English headings name today, yesterday, then weekday and date, with the year for other years', async () => {
    expect(await headings('en', ['2026-11-26', '2026-11-25', '2026-11-23', '2025-12-05'])).toEqual([
      'Today, November 26',
      'Yesterday, November 25',
      'Monday, November 23',
      'Friday, December 5, 2025',
    ])
  })

  it('AC-2: yesterday across New Year gets the year, and 1 January is not "today" on 2 January', async () => {
    await i18n.changeLanguage('en')
    expect(dayHeading('2025-12-31', '2026-01-01', 'en', i18n.t)).toBe(
      'Yesterday, December 31, 2025',
    )
    expect(dayHeading('2026-01-01', '2026-01-03', 'en', i18n.t)).toBe('Thursday, January 1')
  })

  it('AC-3: lengths read m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(1000)).toBe('0:01')
    expect(formatDuration(108_000)).toBe('1:48')
    expect(formatDuration(151_900)).toBe('2:31')
    expect(formatDuration(3_725_000)).toBe('62:05')
  })

  it('AC-8: the greeting follows the hour: 5 to 10, 10 to 18, 18 to 5', () => {
    const hours = [4, 5, 9, 10, 17, 18, 23, 0]
    expect(hours.map(greetingPeriod)).toEqual([
      'evening',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'evening',
    ])
  })
})
