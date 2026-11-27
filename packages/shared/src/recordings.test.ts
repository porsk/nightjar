import { describe, expect, it } from 'vitest'
import {
  liveEventSchema,
  maxUploadBytes,
  recordingSchema,
  setTranscriptionSchema,
  transcriptionStatusSchema,
  updateTranscriptSchema,
} from './recordings.ts'

describe('003-voice-entries: shared schemas', () => {
  it('AC-9: the upload limit is 200 MB', () => {
    expect(maxUploadBytes).toBe(200 * 1024 * 1024)
  })

  it('AC-12: live events are either a recording change or a model change', () => {
    expect(
      liveEventSchema.safeParse({
        type: 'recording.updated',
        entryId: 'e1',
        recordingId: 'r1',
        status: 'done',
      }).success,
    ).toBe(true)
    expect(
      liveEventSchema.safeParse({
        type: 'model.updated',
        state: 'downloading',
        downloadedBytes: 10,
        totalBytes: 100,
      }).success,
    ).toBe(true)
    expect(liveEventSchema.safeParse({ type: 'other' }).success).toBe(false)
    expect(
      liveEventSchema.safeParse({
        type: 'recording.updated',
        entryId: 'e1',
        recordingId: 'r1',
        status: 'sleeping',
      }).success,
    ).toBe(false)
  })

  it('AC-11: a recording carries its status and an optional transcript', () => {
    const base = {
      id: 'r1',
      entryId: 'e1',
      status: 'pending',
      durationMs: 1000,
      mimeType: 'audio/webm',
      language: 'auto',
      createdAt: '2026-11-26T20:30:00.000Z',
      transcript: null,
    }
    expect(recordingSchema.safeParse(base).success).toBe(true)
    expect(recordingSchema.safeParse({ ...base, language: 'fr' }).success).toBe(false)
  })

  it('AC-17: an edited transcript is text of limited length', () => {
    expect(updateTranscriptSchema.safeParse({ text: 'new words' }).success).toBe(true)
    expect(updateTranscriptSchema.safeParse({ text: 5 }).success).toBe(false)
    expect(updateTranscriptSchema.safeParse({ text: 'x'.repeat(100_001) }).success).toBe(false)
  })

  it('AC-21: the admin endpoints take only an enabled flag and answer with a state', () => {
    expect(setTranscriptionSchema.safeParse({ enabled: true }).success).toBe(true)
    expect(setTranscriptionSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false)
    expect(
      transcriptionStatusSchema.safeParse({
        enabled: true,
        state: 'ready',
        downloadedBytes: 1,
        totalBytes: 1,
        backlogCount: 0,
      }).success,
    ).toBe(true)
  })
})
