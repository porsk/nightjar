import type { RecordingStatus, TranscriptionStatus } from '@nightjar/shared/recordings'
import { asc, count, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { instanceSettings, recordings } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import type { Events } from '../../events.ts'
import type { Jobs } from '../../jobs.ts'
import type { Logger } from '../../logger.ts'
import type { Storage } from '../../storage.ts'
import { createModelManager } from './model-manager.ts'
import { defaultModel, downloadBytes, isModelReady, type ModelList } from './models.ts'

interface Dependencies {
  database: Database
  storage: Storage
  jobs: Pick<Jobs, 'enqueueTranscription'>
  events: Events
  logger: Logger
  models: ModelList
}

interface SavedRecording {
  id: string
  userId: string
  entryId: string
  durationMs: number
}

/** Decides what happens to recordings: transcribed, waiting for the model, or left as audio only. */
export function createTranscriptionService({
  database,
  storage,
  jobs,
  events,
  logger,
  models,
}: Dependencies) {
  const { db } = database
  const model = defaultModel(models)

  const isEnabled = async () => {
    const [settings] = await db
      .select({ enabled: instanceSettings.transcriptionEnabled })
      .from(instanceSettings)
    return settings?.enabled ?? false
  }

  const countByStatus = async (status: RecordingStatus) => {
    const [row] = await db
      .select({ total: count() })
      .from(recordings)
      .where(eq(recordings.status, status))
    return row?.total ?? 0
  }

  async function status(): Promise<TranscriptionStatus> {
    const enabled = await isEnabled()
    const backlogCount = await countByStatus('skipped')
    const totalBytes = downloadBytes(model)
    if (!enabled) return { enabled, state: 'off', downloadedBytes: 0, totalBytes, backlogCount }
    if (await isModelReady(storage, model)) {
      return { enabled, state: 'ready', downloadedBytes: totalBytes, totalBytes, backlogCount }
    }
    const [saved] = await db
      .select({
        state: instanceSettings.modelDownloadState,
        downloadedBytes: instanceSettings.modelDownloadedBytes,
      })
      .from(instanceSettings)
    return {
      enabled,
      state: saved?.state === 'failed' ? 'failed' : 'downloading',
      downloadedBytes: saved?.downloadedBytes ?? 0,
      totalBytes,
      backlogCount,
    }
  }

  const queue = (recording: SavedRecording, requestId?: string) =>
    jobs.enqueueTranscription(
      { userId: recording.userId, recordingId: recording.id, requestId },
      recording.durationMs,
    )

  /** Queues every recording that waits for the model or was left half done by a stopped server. */
  async function queueWaiting() {
    const waiting = await db
      .select({
        id: recordings.id,
        userId: recordings.userId,
        entryId: recordings.entryId,
        durationMs: recordings.durationMs,
      })
      .from(recordings)
      .where(inArray(recordings.status, ['pending', 'transcribing']))
      .orderBy(asc(recordings.createdAt), asc(recordings.id))
    for (const recording of waiting) await queue(recording)
  }

  /** Model events go out one after the other, so the last one is always the newest. */
  let publishing = Promise.resolve()

  const manager = createModelManager({
    storage,
    model,
    logger,
    onChange: (download) => {
      publishing = publishing
        .then(async () => {
          await db
            .update(instanceSettings)
            .set({
              modelDownloadState: download.state,
              modelDownloadedBytes: download.downloadedBytes,
            })
            .where(eq(instanceSettings.id, 1))
          const { state, downloadedBytes, totalBytes } = await status()
          await events.publishToAdmins({
            type: 'model.updated',
            state,
            downloadedBytes,
            totalBytes,
          })
        })
        .catch(() => {
          logger.warn('could not publish the model state')
        })
    },
    onReady: () => {
      void queueWaiting().catch(() => {
        logger.warn('could not queue the recordings that were waiting')
      })
    },
  })

  return {
    status,

    /** Turns transcription on or off. Turning it on downloads the model if it is not there yet. */
    setEnabled: async (enabled: boolean) => {
      await db
        .update(instanceSettings)
        .set({ transcriptionEnabled: enabled })
        .where(eq(instanceSettings.id, 1))
      if (enabled) {
        await manager.start()
      } else {
        manager.cancel()
        const stopped = await db
          .update(recordings)
          .set({ status: 'skipped' })
          .where(eq(recordings.status, 'pending'))
          .returning({ id: recordings.id, userId: recordings.userId, entryId: recordings.entryId })
        for (const recording of stopped) {
          await events.publishToUser(recording.userId, {
            type: 'recording.updated',
            entryId: recording.entryId,
            recordingId: recording.id,
            status: 'skipped',
          })
        }
      }
      return status()
    },

    /** The state of a recording that was just saved. */
    initialStatus: async (): Promise<'pending' | 'skipped'> =>
      (await isEnabled()) ? 'pending' : 'skipped',

    /** Queues a saved recording when the model is ready. Otherwise it waits and is queued once the model arrives. */
    schedule: async (recording: SavedRecording, requestId?: string) => {
      if ((await isEnabled()) && (await isModelReady(storage, model)))
        await queue(recording, requestId)
    },

    /** Moves recordings that were never transcribed into the queue. Returns how many. */
    transcribeBacklog: async (requestId?: string) => {
      if (!(await isEnabled()) || !(await isModelReady(storage, model))) {
        throw new AppError(409, 'model_not_ready')
      }
      const moved = await db
        .update(recordings)
        .set({ status: 'pending' })
        .where(eq(recordings.status, 'skipped'))
        .returning({
          id: recordings.id,
          userId: recordings.userId,
          entryId: recordings.entryId,
          durationMs: recordings.durationMs,
          createdAt: recordings.createdAt,
        })
      moved.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      for (const recording of moved) {
        await events.publishToUser(recording.userId, {
          type: 'recording.updated',
          entryId: recording.entryId,
          recordingId: recording.id,
          status: 'pending',
        })
        await queue(recording, requestId)
      }
      return moved.length
    },

    /** On server start: fetch the model if it is missing, or pick up recordings that never got a job. */
    resume: async () => {
      if (await isEnabled()) await manager.start()
    },

    whenIdle: () => manager.whenIdle(),
  }
}

export type TranscriptionService = ReturnType<typeof createTranscriptionService>
