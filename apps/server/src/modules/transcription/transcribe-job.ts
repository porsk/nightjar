import type { RecordingStatus } from '@nightjar/shared/recordings'
import { and, eq } from 'drizzle-orm'
import { UnreadableAudioError, convertToWav } from '../../audio/ffmpeg.ts'
import type { Database } from '../../database.ts'
import { instanceSettings, recordings, transcripts } from '../../db/schema.ts'
import type { Events } from '../../events.ts'
import type { TranscribeJob } from '../../jobs.ts'
import type { Logger } from '../../logger.ts'
import type { Metrics } from '../../metrics.ts'
import type { Storage } from '../../storage.ts'
import type { Transcriber, TranscriberFactory } from './transcriber.ts'

interface Dependencies {
  database: Database
  storage: Storage
  events: Events
  metrics: Metrics
  logger: Logger
  createTranscriber: TranscriberFactory
  /** Tells whether more jobs are waiting, so the model can be released when none are. */
  hasQueuedJobs: () => Promise<boolean>
}

type Outcome = 'completed' | 'skipped' | 'failed' | 'retried'

const waiting: RecordingStatus[] = ['pending', 'transcribing']

/**
 * Handles one transcription job. Safe to run twice: it only works on recordings that still wait for
 * a transcript, and never overwrites text the user edited.
 */
export function createTranscribeHandler({
  database,
  storage,
  events,
  metrics,
  logger,
  createTranscriber,
  hasQueuedJobs,
}: Dependencies) {
  const { db } = database
  let transcriber: Transcriber | undefined

  const setStatus = async (
    recording: { id: string; userId: string; entryId: string },
    status: RecordingStatus,
  ) => {
    await db.update(recordings).set({ status }).where(eq(recordings.id, recording.id))
    await events.publishToUser(recording.userId, {
      type: 'recording.updated',
      entryId: recording.entryId,
      recordingId: recording.id,
      status,
    })
  }

  const releaseModelWhenIdle = async () => {
    if (!transcriber || (await hasQueuedJobs())) return
    transcriber.dispose()
    transcriber = undefined
  }

  async function transcribe(job: TranscribeJob, log: Logger): Promise<Outcome> {
    const { recordingId, userId } = job.data
    const [recording] = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    if (!recording || !waiting.includes(recording.status)) return 'skipped'

    const [settings] = await db
      .select({ enabled: instanceSettings.transcriptionEnabled })
      .from(instanceSettings)
    if (!settings?.enabled) {
      await setStatus(recording, 'skipped')
      return 'skipped'
    }

    await setStatus(recording, 'transcribing')
    const wav = await storage.tempFile('wav')
    try {
      await convertToWav(storage.localPath(recording.filePath), wav.path)
      transcriber ??= createTranscriber()
      const startedAt = performance.now()
      const result = await transcriber.transcribe(wav.path, recording.language)
      const seconds = (performance.now() - startedAt) / 1000
      if (recording.durationMs > 0) {
        metrics.transcriptionRtf
          .labels({ model: transcriber.modelId })
          .observe(seconds / (recording.durationMs / 1000))
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(transcripts)
          .values({
            userId,
            recordingId,
            model: transcriber?.modelId ?? 'unknown',
            language: result.language,
            text: result.text,
          })
          .onConflictDoUpdate({
            target: transcripts.recordingId,
            set: {
              model: transcriber?.modelId ?? 'unknown',
              language: result.language,
              text: result.text,
            },
            setWhere: eq(transcripts.isUserEdited, false),
          })
        await tx.update(recordings).set({ status: 'done' }).where(eq(recordings.id, recordingId))
      })
      await events.publishToUser(userId, {
        type: 'recording.updated',
        entryId: recording.entryId,
        recordingId,
        status: 'done',
      })
      return 'completed'
    } catch (error) {
      const lastAttempt = job.retryCount >= job.retryLimit
      log.warn(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          unreadable: error instanceof UnreadableAudioError,
          attempt: job.retryCount + 1,
          lastAttempt,
        },
        'transcription failed',
      )
      if (lastAttempt) await setStatus(recording, 'failed')
      throw error
    } finally {
      await wav.remove()
    }
  }

  return async (job: TranscribeJob) => {
    const log = logger.child({ jobId: job.id, requestId: job.data.requestId })
    const startedAt = performance.now()
    let outcome: Outcome = 'failed'
    log.info('transcription job started')
    try {
      outcome = await transcribe(job, log)
    } catch (error) {
      outcome = job.retryCount >= job.retryLimit ? 'failed' : 'retried'
      throw error
    } finally {
      metrics.jobDuration
        .labels({ queue: job.name, outcome })
        .observe((performance.now() - startedAt) / 1000)
      log.info({ outcome }, 'transcription job finished')
      await releaseModelWhenIdle()
    }
  }
}
