import type { FailureCode, RecordingStatus } from '@nightjar/shared/recordings'
import { and, eq } from 'drizzle-orm'
import { extname } from 'node:path'
import { ffmpegFormatFor } from '../../audio/sniff.ts'
import { UnreadableAudioError, convertToWav } from '../../audio/ffmpeg.ts'
import type { Database } from '../../database.ts'
import { instanceSettings, recordings, transcripts } from '../../db/schema.ts'
import type { Events } from '../../events.ts'
import type { TranscribeJob } from '../../jobs.ts'
import type { Logger } from '../../logger.ts'
import type { Metrics } from '../../metrics.ts'
import type { Storage } from '../../storage.ts'
import type { AudioExtension, CloudProvider } from './cloud/provider.ts'
import { KeyUnavailableError, ProviderError } from './cloud/provider.ts'
import { providerById } from './cloud/registry.ts'
import { modelById, type ModelList } from './models.ts'
import type { AudioFile, Transcriber, TranscriberFactory } from './transcriber.ts'

interface Dependencies {
  database: Database
  storage: Storage
  events: Events
  metrics: Metrics
  logger: Logger
  createTranscriber: TranscriberFactory
  models: ModelList
  providers: readonly CloudProvider[]
  /** Tells whether more jobs are waiting, so the model can be released when none are. */
  hasQueuedJobs: () => Promise<boolean>
}

type Outcome = 'completed' | 'skipped' | 'failed' | 'retried'

const waiting: RecordingStatus[] = ['pending', 'transcribing']

/** These do not get better by trying again, so the recording fails at once. */
const permanent: FailureCode[] = ['api_key_invalid', 'quota_exceeded', 'audio_rejected']

const failureOf = (error: unknown): FailureCode | null =>
  error instanceof ProviderError ? error.code : null

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
  models,
  providers,
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

  /** Frees the model and waits until it is gone, so two models are never loaded at once. */
  const dropModel = async () => {
    const old = transcriber
    transcriber = undefined
    await old?.dispose()
  }

  const releaseModelWhenIdle = async () => {
    if (transcriber && !(await hasQueuedJobs())) await dropModel()
  }

  const fail = async (
    recording: { id: string; userId: string; entryId: string },
    failure: FailureCode | null,
  ) => {
    await db
      .update(recordings)
      .set({ replaceEdited: false, failure })
      .where(eq(recordings.id, recording.id))
    await setStatus(recording, 'failed')
  }

  async function transcribe(job: TranscribeJob, log: Logger): Promise<Outcome> {
    const { recordingId, userId } = job.data
    const [recording] = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    if (!recording || !waiting.includes(recording.status)) return 'skipped'

    const [settings] = await db
      .select({
        enabled: instanceSettings.transcriptionEnabled,
        activeEngine: instanceSettings.activeEngine,
      })
      .from(instanceSettings)
    if (!settings?.enabled) {
      await db
        .update(recordings)
        .set({ replaceEdited: false })
        .where(eq(recordings.id, recording.id))
      await setStatus(recording, 'skipped')
      return 'skipped'
    }
    const engineId =
      providerById(providers, settings.activeEngine)?.id ??
      modelById(models, settings.activeEngine).id
    if (transcriber && transcriber.modelId !== engineId) await dropModel()

    await setStatus(recording, 'transcribing')
    let wav: Awaited<ReturnType<Storage['tempFile']>> | undefined
    try {
      transcriber ??= createTranscriber(engineId)
      const extension = extname(recording.filePath).slice(1) as AudioExtension
      const audio: AudioFile = {
        path: storage.localPath(recording.filePath),
        extension,
        durationMs: recording.durationMs,
        recordingId,
        userId,
      }
      if (transcriber.input === 'wav') {
        wav = await storage.tempFile('wav')
        await convertToWav(audio.path, wav.path, ffmpegFormatFor(extension) ?? '')
        audio.path = wav.path
        audio.extension = 'wav'
      }
      const modelId = transcriber.modelId
      const startedAt = performance.now()
      const result = await transcriber.transcribe(audio, recording.language, job.signal)
      const seconds = (performance.now() - startedAt) / 1000
      if (recording.durationMs > 0) {
        metrics.transcriptionRtf
          .labels({ model: modelId })
          .observe(seconds / (recording.durationMs / 1000))
      }

      const replaceEdited = job.data.replaceEdited === true || recording.replaceEdited
      await db.transaction(async (tx) => {
        await tx
          .insert(transcripts)
          .values({
            userId,
            recordingId,
            model: modelId,
            language: result.language,
            text: result.text,
            transcribedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: transcripts.recordingId,
            set: {
              model: modelId,
              language: result.language,
              text: result.text,
              transcribedAt: new Date(),
              ...(replaceEdited ? { isUserEdited: false } : {}),
            },
            ...(replaceEdited ? {} : { setWhere: eq(transcripts.isUserEdited, false) }),
          })
        await tx
          .update(recordings)
          .set({ status: 'done', replaceEdited: false, failure: null })
          .where(eq(recordings.id, recordingId))
      })
      await events.publishToUser(userId, {
        type: 'recording.updated',
        entryId: recording.entryId,
        recordingId,
        status: 'done',
      })
      return 'completed'
    } catch (error) {
      if (error instanceof KeyUnavailableError) {
        await setStatus(recording, 'pending')
        return 'skipped'
      }
      const failure = failureOf(error)
      const lastAttempt = job.retryCount >= job.retryLimit
      log.warn(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          unreadable: error instanceof UnreadableAudioError,
          ...(failure ? { failure } : {}),
          ...(error instanceof ProviderError && error.httpStatus !== undefined
            ? { httpStatus: error.httpStatus }
            : {}),
          attempt: job.retryCount + 1,
          lastAttempt,
        },
        'transcription failed',
      )
      await dropModel()
      if (failure && permanent.includes(failure)) {
        await fail(recording, failure)
        return 'failed'
      }
      if (lastAttempt) await fail(recording, failure)
      throw error
    } finally {
      await wav?.remove()
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
