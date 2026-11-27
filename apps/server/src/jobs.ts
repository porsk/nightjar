import { PgBoss, type JobWithMetadata } from 'pg-boss'
import type { Logger } from './logger.ts'

export const transcribeQueue = 'transcribe'

/** A job that runs longer than this many seconds per second of audio, or this floor, counts as stuck. */
const expiryPerAudioSecond = 5
const minExpirySeconds = 600

export interface TranscribeJobData {
  userId: string
  recordingId: string
  /** The request that queued the job, so its log lines can be followed into the worker. */
  requestId?: string | undefined
}

export type TranscribeJob = JobWithMetadata<TranscribeJobData>

export interface JobsOptions {
  retryLimit?: number
  retryDelaySeconds?: number
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
    },

    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),

    /** A recording that is already queued is not queued twice. */
    enqueueTranscription: async (data: TranscribeJobData, durationMs: number) => {
      await boss.send(transcribeQueue, data, {
        singletonKey: data.recordingId,
        expireInSeconds: Math.max(
          minExpirySeconds,
          Math.ceil((durationMs / 1000) * expiryPerAudioSecond),
        ),
      })
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
