import type { Language } from '@nightjar/shared'

/** "Thursday, November 26, 2026" or "2026. november 26., csütörtök". */
export const formatDate = (date: Date, language: Language, timeZone: string) =>
  new Intl.DateTimeFormat(language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(date)

/** "1:48" for a length in milliseconds. */
export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening'

export const greetingPeriod = (hour: number): GreetingPeriod =>
  hour >= 5 && hour < 10 ? 'morning' : hour >= 10 && hour < 18 ? 'afternoon' : 'evening'

/** The hour of the day, 0 to 23, in the given time zone. */
export const hourIn = (date: Date, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date),
  )

/** "9:30 PM" or "21:30". */
export const formatTime = (date: Date, language: Language, timeZone: string) =>
  new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit', timeZone }).format(date)

const pad = (value: number) => String(value).padStart(2, '0')

/** "02:14" for the recorder timer. */
export const formatTimer = (milliseconds: number) => {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** "3.2 MB" or "3,2 MB". */
export const formatSize = (bytes: number, language: Language) =>
  `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`

/** "564 MB" under 1 GB, "1,1 GB" or "1.1 GB" from 1 GB. A non-breaking space keeps the unit with the number. */
export function formatModelSize(bytes: number, language: Language) {
  if (bytes < 1_000_000_000) {
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(bytes / 1_000_000)}\u00a0MB`
  }
  return `${new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1_000_000_000)}\u00a0GB`
}
