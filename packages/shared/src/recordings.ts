import { z } from 'zod'
import { bodyMaxLength, entryLanguageSchema, languageSchema } from './index.ts'

export const maxUploadBytes = 200 * 1024 * 1024

/** The longest recording, in milliseconds. A longer one is too much to hold in memory while it is transcribed. */
export const maxRecordingMs = 3 * 60 * 60 * 1000

export const recordingStatusSchema = z.enum([
  'pending',
  'transcribing',
  'done',
  'failed',
  'skipped',
])
export type RecordingStatus = z.infer<typeof recordingStatusSchema>

export const transcriptSchema = z.object({
  text: z.string(),
  language: languageSchema,
  model: z.string(),
  isUserEdited: z.boolean(),
  updatedAt: z.string(),
})
export type Transcript = z.infer<typeof transcriptSchema>

export const failureCodeSchema = z.enum([
  'api_key_invalid',
  'quota_exceeded',
  'provider_unavailable',
  'timeout',
  'audio_rejected',
])
export type FailureCode = z.infer<typeof failureCodeSchema>

export const recordingSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  status: recordingStatusSchema,
  durationMs: z.number().int().nonnegative(),
  mimeType: z.string(),
  language: entryLanguageSchema,
  failure: failureCodeSchema.nullable(),
  createdAt: z.string(),
  transcript: transcriptSchema.nullable(),
})
export type Recording = z.infer<typeof recordingSchema>

export const recordingsResponseSchema = z.array(recordingSchema)

export const updateTranscriptSchema = z.object({ text: z.string().max(bodyMaxLength) })

export const transcriptionStateSchema = z.enum([
  'off',
  'downloading',
  'ready',
  'failed',
  'needs_key',
])
export type TranscriptionState = z.infer<typeof transcriptionStateSchema>

export const modelStateSchema = z.enum(['not_downloaded', 'downloading', 'downloaded', 'failed'])
export type ModelState = z.infer<typeof modelStateSchema>

export const modelStatusSchema = z.object({
  id: z.string(),
  state: modelStateSchema,
  /** Size of the download. */
  downloadBytes: z.number().int().nonnegative(),
  /** Sum of the model files, what deleting frees. */
  diskBytes: z.number().int().nonnegative(),
  /** Progress while downloading, else 0. */
  downloadedBytes: z.number().int().nonnegative(),
  /** The running or failed download makes the model active when it is done. */
  useWhenReady: z.boolean(),
  /** Set when the state is `failed`. */
  error: z.enum(['download_failed', 'disk_full']).nullable(),
})
export type ModelStatus = z.infer<typeof modelStatusSchema>

export const engineKindSchema = z.enum(['local', 'cloud'])
export type EngineKind = z.infer<typeof engineKindSchema>

export const providerStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** A readable key is saved. */
  configured: z.boolean(),
  keyError: z.enum(['unreadable']).nullable(),
  pricePerHour: z.object({ amount: z.number().nonnegative(), currency: z.enum(['USD', 'EUR']) }),
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const engineUsageSchema = z.object({
  engine: z.string(),
  /** Audio transcribed this month, in the time zone of the admin who asks. */
  audioMs: z.number().int().nonnegative(),
  /** In the currency of the provider. */
  estimatedCost: z.number().nonnegative(),
})
export type EngineUsage = z.infer<typeof engineUsageSchema>

const engineListFields = {
  activeEngine: z.string(),
  /** In the order of the model list. */
  models: z.array(modelStatusSchema),
  /** In the order of the provider registry. */
  providers: z.array(providerStatusSchema),
}

export const providerSecretsSchema = z.strictObject({ apiKey: z.string().trim().min(1).max(512) })

export const keyTestResultSchema = z.object({
  result: z.enum(['ok', 'invalid_key', 'unreachable']),
})
export type KeyTestResult = z.infer<typeof keyTestResultSchema>

export const transcriptionStatusSchema = z.object({
  enabled: z.boolean(),
  state: transcriptionStateSchema,
  downloadedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  backlogCount: z.number().int().nonnegative(),
  ...engineListFields,
  /** One per provider. */
  usage: z.array(engineUsageSchema),
})
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>

export const setTranscriptionSchema = z.strictObject({ enabled: z.boolean() })

export const retranscribeSchema = z.strictObject({ replaceEdited: z.boolean().optional() })

export const transcriptionAvailabilitySchema = z.object({
  state: z.enum(['off', 'not_ready', 'ready']),
  engine: z.object({ id: z.string(), kind: engineKindSchema }),
})
export type TranscriptionAvailability = z.infer<typeof transcriptionAvailabilitySchema>

export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('recording.updated'),
    entryId: z.string(),
    recordingId: z.string(),
    status: recordingStatusSchema,
  }),
  z.object({
    type: z.literal('model.updated'),
    state: transcriptionStateSchema,
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    ...engineListFields,
  }),
])
export type LiveEvent = z.infer<typeof liveEventSchema>
