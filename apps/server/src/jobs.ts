import { PgBoss, type JobWithMetadata } from 'pg-boss'
import type { Logger } from './logger.ts'

export const transcribeQueue = 'transcribe'

export const cleanupQueue = 'cloud-cleanup'

/** A job that runs longer than this many seconds per second of audio, or this floor, counts as stuck. */
const expiryPerAudioSecond = 5
export const minExpirySeconds = 1800

/** Seconds a job may run for a recording of this length. */
export const expiryFor = (durationMs: number) =>
  Math.max(minExpirySeconds, Math.ceil((durationMs / 1000) * expiryPerAudioSecond))

export interface TranscribeJobData {
  userId: string
  recordingId: string
  /** The request that queued the job, so its log lines can be followed into the worker. */
  requestId?: string | undefined
  /** Replace the transcript even when the user edited it. */
  replaceEdited?: boolean
}

export type TranscribeJob = JobWithMetadata<TranscribeJobData>

export const cleanupRetryLimit = 3

export type CleanupJob = JobWithMetadata<Record<string, never>>

export interface JobsOptions {
  retryLimit?: number
  retryDelaySeconds?: number
  cleanupRetryDelaySeconds?: number
  pollingIntervalSeconds?: number
}

/** The queue, backed by Postgres. Web code only queues, the worker takes jobs. */
export function createJobs(databaseUrl: string, logger: Logger, options: JobsOptions = {}) {
  const boss = new PgBoss({ connectionString: databaseUrl, max: 4, schedule: false })
  boss.on('error', (error) => {
    logger.error({ errorName: error.name }, 'job system error')
  })

  return {
    boss,
    pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,

    start: async () => {
      await boss.start()
      await boss.createQueue(transcribeQueue, {
        policy: 'short',
        retryLimit: options.retryLimit ?? 2,
        retryDelay: options.retryDelaySeconds ?? 30,
        expireInSeconds: 6 * 60 * 60,
      })
      await boss.createQueue(cleanupQueue, {
        policy: 'short',
        retryLimit: cleanupRetryLimit,
        retryDelay: options.cleanupRetryDelaySeconds ?? 60,
        retryBackoff: true,
        expireInSeconds: 15 * 60,
      })
    },

    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),

    /** A recording that is already queued is not queued twice. */
    enqueueTranscription: async (data: TranscribeJobData, durationMs: number) => {
      await boss.send(transcribeQueue, data, {
        singletonKey: data.recordingId,
        expireInSeconds: expiryFor(durationMs),
      })
    },

    /** Deletes copies left at cloud providers. The queue holds at most one waiting job. */
    enqueueCloudCleanup: async () => {
      await boss.send(cleanupQueue, {})
    },

    /** Jobs that are waiting to run, per queue. Read from the job table, so it is never behind. */
    queueDepths: async (): Promise<Record<string, number>> => {
      const waiting = await boss.findJobs(transcribeQueue, { queued: true, limit: 1000 })
      return { [transcribeQueue]: waiting.length }
    },

    hasQueuedJobs: async () =>
      (await boss.findJobs(transcribeQueue, { queued: true, limit: 1 })).length > 0,
  }
}

export type Jobs = ReturnType<typeof createJobs>
