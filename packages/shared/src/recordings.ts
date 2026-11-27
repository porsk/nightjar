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

export const recordingSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  status: recordingStatusSchema,
  durationMs: z.number().int().nonnegative(),
  mimeType: z.string(),
  language: entryLanguageSchema,
  createdAt: z.string(),
  transcript: transcriptSchema.nullable(),
})
export type Recording = z.infer<typeof recordingSchema>

export const recordingsResponseSchema = z.array(recordingSchema)

export const updateTranscriptSchema = z.object({ text: z.string().max(bodyMaxLength) })

export const transcriptionStateSchema = z.enum(['off', 'downloading', 'ready', 'failed'])
export type TranscriptionState = z.infer<typeof transcriptionStateSchema>

export const transcriptionStatusSchema = z.object({
  enabled: z.boolean(),
  state: transcriptionStateSchema,
  downloadedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  backlogCount: z.number().int().nonnegative(),
})
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>

export const setTranscriptionSchema = z.strictObject({ enabled: z.boolean() })

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
  }),
])
export type LiveEvent = z.infer<typeof liveEventSchema>
