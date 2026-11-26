import { z } from 'zod'

export const healthResponseSchema = z.object({ status: z.literal('ok') })

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const readyResponseSchema = z.object({ status: z.enum(['ok', 'starting', 'db_down']) })

export type ReadyResponse = z.infer<typeof readyResponseSchema>

export const languageSchema = z.enum(['hu', 'en'])
export type Language = z.infer<typeof languageSchema>

export const passwordMinLength = 8

export const entryLanguageSchema = z.enum(['hu', 'en', 'auto'])
export type EntryLanguage = z.infer<typeof entryLanguageSchema>

export const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const timeZoneSchema = z.string().refine(isTimeZone)

export const setupAccountSchema = z.object({
  setupCode: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(passwordMinLength).max(128),
})

export const setupRequestSchema = setupAccountSchema.extend({
  uiLanguage: languageSchema,
  timeZone: timeZoneSchema,
  transcriptionEnabled: z.boolean(),
})
export type SetupRequest = z.infer<typeof setupRequestSchema>

export const setupStatusSchema = z.object({ needed: z.boolean() })

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  uiLanguage: languageSchema,
  entryLanguage: entryLanguageSchema,
  timeZone: z.string(),
})
export type Me = z.infer<typeof meResponseSchema>

/** The time zone is checked by the route, which answers `invalid_time_zone` for it. */
export const settingsPatchSchema = z
  .strictObject({
    uiLanguage: languageSchema,
    entryLanguage: entryLanguageSchema,
    timeZone: z.string(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0)
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

export const bodyMaxLength = 100_000

const isCalendarDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** A calendar day as `YYYY-MM-DD`. Such strings compare in date order. */
export const entryDateSchema = z.string().refine(isCalendarDay)

export const createEntrySchema = z.object({
  bodyMd: z.string().max(bodyMaxLength).optional(),
  entryDate: entryDateSchema.optional(),
})
export type CreateEntry = z.infer<typeof createEntrySchema>

export const updateEntrySchema = createEntrySchema
export type UpdateEntry = z.infer<typeof updateEntrySchema>

export const entryResponseSchema = z.object({
  id: z.string(),
  entryDate: entryDateSchema,
  bodyMd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Entry = z.infer<typeof entryResponseSchema>

/** The calendar day it is right now in the given time zone. */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
