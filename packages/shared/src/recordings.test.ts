import { describe, expect, it } from 'vitest'
import {
  liveEventSchema,
  maxUploadBytes,
  recordingSchema,
  setTranscriptionSchema,
  failureCodeSchema,
  keyTestResultSchema,
  providerSecretsSchema,
  transcriptionAvailabilitySchema,
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
        activeEngine: 'm1',
        models: [],
        providers: [],
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
      failure: null,
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
        activeEngine: 'm1',
        providers: [],
        usage: [],
        models: [
          {
            id: 'm1',
            state: 'downloaded',
            downloadBytes: 1,
            diskBytes: 1,
            downloadedBytes: 0,
            useWhenReady: false,
            error: null,
          },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('010-cloud-transcription: shared schemas', () => {
  it('AC-4: the key body is one trimmed string of 1 to 512 characters and nothing else', () => {
    expect(providerSecretsSchema.parse({ apiKey: '  abc  ' })).toEqual({ apiKey: 'abc' })
    expect(providerSecretsSchema.safeParse({ apiKey: '' }).success).toBe(false)
    expect(providerSecretsSchema.safeParse({ apiKey: '   ' }).success).toBe(false)
    expect(providerSecretsSchema.safeParse({ apiKey: 'x'.repeat(513) }).success).toBe(false)
    expect(providerSecretsSchema.safeParse({ apiKey: 'x'.repeat(512) }).success).toBe(true)
    expect(providerSecretsSchema.safeParse({ apiKey: 'x', extra: 1 }).success).toBe(false)
  })

  it('AC-7: a key test answers ok, invalid_key or unreachable', () => {
    for (const result of ['ok', 'invalid_key', 'unreachable']) {
      expect(keyTestResultSchema.safeParse({ result }).success).toBe(true)
    }
    expect(keyTestResultSchema.safeParse({ result: 'maybe' }).success).toBe(false)
  })

  it('AC-22: the failure codes are the five from the spec and availability names the engine', () => {
    expect(failureCodeSchema.options).toEqual([
      'api_key_invalid',
      'quota_exceeded',
      'provider_unavailable',
      'timeout',
      'audio_rejected',
    ])
    expect(
      transcriptionAvailabilitySchema.safeParse({
        state: 'ready',
        engine: { id: 'soniox', kind: 'cloud' },
      }).success,
    ).toBe(true)
    expect(transcriptionAvailabilitySchema.safeParse({ state: 'ready' }).success).toBe(false)
  })

  it('AC-13: the status can say a key is needed', () => {
    expect(
      transcriptionStatusSchema.safeParse({
        enabled: true,
        state: 'needs_key',
        downloadedBytes: 0,
        totalBytes: 0,
        backlogCount: 0,
        activeEngine: 'soniox',
        models: [],
        providers: [
          {
            id: 'soniox',
            label: 'Soniox',
            configured: false,
            keyError: 'unreadable',
            pricePerHour: { amount: 0.1, currency: 'USD' },
          },
        ],
        usage: [{ engine: 'soniox', audioMs: 0, estimatedCost: 0 }],
      }).success,
    ).toBe(true)
  })
})
