import { z } from 'zod'

export const healthResponseSchema = z.object({ status: z.literal('ok') })

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const readyResponseSchema = z.object({ status: z.enum(['ok', 'starting', 'db_down']) })

export type ReadyResponse = z.infer<typeof readyResponseSchema>

export const languageSchema = z.enum(['hu', 'en'])
export type Language = z.infer<typeof languageSchema>

export const passwordMinLength = 8

const isTimeZone = (value: string) => {
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
  entryLanguage: z.enum(['hu', 'en', 'auto']),
  timeZone: z.string(),
})
export type Me = z.infer<typeof meResponseSchema>

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
