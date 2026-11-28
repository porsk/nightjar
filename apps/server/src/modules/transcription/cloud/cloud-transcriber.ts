import { setTimeout as sleep } from 'node:timers/promises'
import type { Language } from '@nightjar/shared'
import { eq } from 'drizzle-orm'
import type { Database } from '../../../database.ts'
import { cloudCopies } from '../../../db/schema.ts'
import type { Storage } from '../../../storage.ts'
import type { Transcriber, TranscriptResult } from '../transcriber.ts'
import type { CopyCleaner } from './cleanup.ts'
import {
  KeyUnavailableError,
  ProviderError,
  type CloudProvider,
  type VendorCopy,
} from './provider.ts'
import { containerFor } from './registry.ts'
import type { KeyStore } from './key-store.ts'
import { makeParts } from './split.ts'

export const pollIntervalMs = 3000
const minimumDeadlineMs = 10 * 60_000

interface Dependencies {
  provider: CloudProvider
  database: Database
  storage: Storage
  keys: KeyStore
  cleaner: CopyCleaner
  fetch: typeof fetch
  /** Queues the cleanup job, for copies that could not be deleted right away. */
  queueCleanup: () => Promise<void>
  pollIntervalMs?: number
  /** How long one part may take at the provider before the attempt ends with `timeout`. */
  partDeadlineMs?: (partDurationMs: number) => number
}

const defaultDeadline = (partDurationMs: number) => Math.max(minimumDeadlineMs, partDurationMs)

/**
 * Sends the stored audio to a cloud provider and waits for the text. Every copy made at the provider
 * is deleted at the end of the attempt, whatever the result.
 */
export function createCloudTranscriber({
  provider,
  database,
  storage,
  keys,
  cleaner,
  fetch: fetchFn,
  queueCleanup,
  pollIntervalMs: interval = pollIntervalMs,
  partDeadlineMs = defaultDeadline,
}: Dependencies): Transcriber {
  const { db } = database

  async function transcribePart(
    call: Parameters<CloudProvider['upload']>[0],
    part: { path: string; durationMs: number },
    container: Parameters<CloudProvider['upload']>[1]['extension'],
    language: Parameters<CloudProvider['start']>[2],
    track: (copy: VendorCopy) => Promise<void>,
  ) {
    let copy = await provider.upload(call, { path: part.path, extension: container })
    await track(copy)
    copy = await provider.start(call, copy, language)
    await track(copy)
    const deadline = Date.now() + partDeadlineMs(part.durationMs)
    for (;;) {
      const result = await provider.poll(call, copy)
      if (result.state === 'done') return result
      if (Date.now() >= deadline) throw new ProviderError('timeout')
      await sleep(interval, undefined, { signal: call.signal })
    }
  }

  return {
    modelId: provider.id,
    input: 'original',

    transcribe: async (audio, language, signal): Promise<TranscriptResult> => {
      const saved = await keys.read(provider.id)
      if (saved.state !== 'ready') throw new KeyUnavailableError()
      const call = { secrets: saved.secrets, fetch: fetchFn, signal }
      await cleaner.removeRows(await cleaner.forRecording(audio.recordingId))

      const container = containerFor(provider, audio.extension)
      if (!container) throw new ProviderError('audio_rejected')
      const attempt = new Set<string>()
      const work = await storage.tempFolder()
      try {
        const parts = await makeParts({
          input: audio.path,
          stored: audio.extension,
          container,
          durationMs: audio.durationMs,
          maxAudioMs: provider.capabilities.maxAudioMs,
          folder: work.path,
        })
        const texts: string[] = []
        let detected: Language | undefined
        for (const [index, part] of parts.entries()) {
          let rowId: string | undefined
          const result = await transcribePart(call, part, container, language, async (copy) => {
            if (rowId === undefined) {
              const [row] = await db
                .insert(cloudCopies)
                .values({
                  providerId: provider.id,
                  userId: audio.userId,
                  recordingId: audio.recordingId,
                  vendorRef: copy,
                })
                .returning({ id: cloudCopies.id })
              rowId = row?.id
              if (rowId) attempt.add(rowId)
            } else {
              await db.update(cloudCopies).set({ vendorRef: copy }).where(eq(cloudCopies.id, rowId))
            }
          })
          texts.push(result.text.trim())
          if (index === 0) detected = result.language
        }
        return {
          text: texts
            .filter((text) => text !== '')
            .join(' ')
            .trim(),
          language: language === 'auto' ? (detected ?? 'en') : language,
        }
      } finally {
        await work.remove()
        const left = await cleaner.removeRows(await cleaner.byIds([...attempt]))
        if (left > 0) await queueCleanup().catch(() => undefined)
      }
    },

    dispose: () => Promise.resolve(),
  }
}
