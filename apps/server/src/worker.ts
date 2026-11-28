import {
  cleanupQueue,
  transcribeQueue,
  type CleanupJob,
  type Jobs,
  type TranscribeJob,
} from './jobs.ts'
import type { Logger } from './logger.ts'
import type { Metrics } from './metrics.ts'

interface Dependencies {
  logger: Logger
  jobs: Jobs
  metrics: Metrics
  transcribe: (job: TranscribeJob) => Promise<void>
  cleanup: (job: CleanupJob) => Promise<void>
}

/** Entry point for background jobs. Runs in the same process as the web server for now. */
export async function startWorker({ logger, jobs, metrics, transcribe, cleanup }: Dependencies) {
  await jobs.start()
  metrics.setQueueDepthSource(jobs.queueDepths)
  await jobs.boss.work<TranscribeJob['data']>(
    transcribeQueue,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: jobs.pollingIntervalSeconds },
    async ([job]) => {
      if (job) await transcribe(job as TranscribeJob)
    },
  )
  await jobs.boss.work<CleanupJob['data']>(
    cleanupQueue,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: jobs.pollingIntervalSeconds },
    async ([job]) => {
      if (job) await cleanup(job as CleanupJob)
    },
  )
  await jobs.enqueueCloudCleanup()
  logger.info('worker started')
  return { stop: () => jobs.stop() }
}
