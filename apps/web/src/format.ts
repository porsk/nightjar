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

/** "9:30 PM" or "21:30". */
export const formatTime = (date: Date, language: Language, timeZone: string) =>
  new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit', timeZone }).format(date)
