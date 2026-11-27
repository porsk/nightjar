import type { Language } from '@nightjar/shared'
import type { TFunction } from 'i18next'
import { formatDate } from './format.ts'

const parseDay = (day: string) => new Date(`${day}T00:00:00Z`)
const formatDay = (date: Date) => date.toISOString().slice(0, 10)

export const addDays = (day: string, amount: number) => {
  const date = parseDay(day)
  date.setUTCDate(date.getUTCDate() + amount)
  return formatDay(date)
}

const format = (day: string, language: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(language, { ...options, timeZone: 'UTC' }).format(parseDay(day))

/** "Nov 26, 2026" or "2026. nov. 26." */
export const shortDate = (day: string, language: string) =>
  format(day, language, { year: 'numeric', month: 'short', day: 'numeric' })

/** "Thursday, November 26, 2026" */
export const longDate = (day: string, language: string) =>
  formatDate(parseDay(day), language as Language, 'UTC')

/** Today and yesterday by name, any other day in full. */
export function dateLabel(day: string, today: string, language: string, t: TFunction) {
  const short = () => format(day, language, { month: 'long', day: 'numeric' })
  if (day === today) return t('date.today', { date: short() })
  if (day === addDays(today, -1)) return t('date.yesterday', { date: short() })
  return longDate(day, language)
}

/** "November 2026" for a `YYYY-MM` month. */
export const monthTitle = (month: string, language: string) =>
  format(`${month}-01`, language, { year: 'numeric', month: 'long' })

/** Short weekday names starting on Monday. */
export const weekdayNames = (language: string) =>
  Array.from({ length: 7 }, (_, index) =>
    format(addDays('2024-01-01', index), language, { weekday: 'short' }),
  )

const capitalize = (text: string, language: string) =>
  text.slice(0, 1).toLocaleUpperCase(language) + text.slice(1)

/** "Thursday" or "csütörtök". */
export const weekdayName = (day: string, language: string) =>
  format(day, language, { weekday: 'long' })

/** "November 26" or "november 26.", with the year when the day is not in `today`'s year. */
export const monthAndDay = (day: string, today: string, language: string) =>
  format(
    day,
    language,
    day.slice(0, 4) === today.slice(0, 4)
      ? { month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  )

/** "Today, November 26", "Yesterday, November 25", then "Monday, November 23". */
export function dayHeading(day: string, today: string, language: string, t: TFunction) {
  const date = monthAndDay(day, today, language)
  if (day === today) return t('date.today', { date })
  if (day === addDays(today, -1)) return t('date.yesterday', { date })
  return `${capitalize(weekdayName(day, language), language)}, ${date}`
}

export const clockTime = (moment: Date, timeZone: string, language: string) =>
  new Intl.DateTimeFormat(language, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(moment)
