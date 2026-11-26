import { z } from 'zod'

export const healthResponseSchema = z.object({ status: z.literal('ok') })

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const readyResponseSchema = z.object({ status: z.enum(['ok', 'starting', 'db_down']) })

export type ReadyResponse = z.infer<typeof readyResponseSchema>
