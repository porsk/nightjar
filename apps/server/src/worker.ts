import { transcribeQueue, type Jobs, type TranscribeJob } from './jobs.ts'
import type { Logger } from './logger.ts'
import type { Metrics } from './metrics.ts'

interface Dependencies {
  logger: Logger
  jobs: Jobs
  metrics: Metrics
  transcribe: (job: TranscribeJob) => Promise<void>
}

/** Entry point for background jobs. Runs in the same process as the web server for now. */
export async function startWorker({ logger, jobs, metrics, transcribe }: Dependencies) {
  await jobs.start()
  metrics.setQueueDepthSource(jobs.queueDepths)
  await jobs.boss.work<TranscribeJob['data']>(
    transcribeQueue,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: jobs.pollingIntervalSeconds },
    async ([job]) => {
      if (job) await transcribe(job as TranscribeJob)
    },
  )
  logger.info('worker started')
  return { stop: () => jobs.stop() }
}
