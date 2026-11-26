import type { Config } from './config.ts'
import { createDatabase } from './database.ts'
import { createEvents } from './events.ts'
import { createJobs, type JobsOptions } from './jobs.ts'
import { serializeFullError, type Logger } from './logger.ts'
import { createAuth, type Auth } from './modules/auth/auth.ts'
import { issueSetupCode } from './modules/auth/setup-code.ts'
import { createFakeTranscriber } from './modules/transcription/fake-transcriber.ts'
import { defaultModel, supportedModels, type ModelList } from './modules/transcription/models.ts'
import { createTranscriptionService } from './modules/transcription/service.ts'
import { createSherpaTranscriber } from './modules/transcription/sherpa-transcriber.ts'
import { createTranscribeHandler } from './modules/transcription/transcribe-job.ts'
import type { TranscriberFactory } from './modules/transcription/transcriber.ts'
import { createMetrics, startMetricsServer } from './metrics.ts'
import { createReadiness } from './readiness.ts'
import { createStorage, modelKey } from './storage.ts'
import { startWeb } from './web.ts'
import { startWorker } from './worker.ts'

export interface StartOptions {
  config: Config
  logger: Logger
  migrationsFolder: string
  exit: (code: number) => void
  /** Replaces the list of models that can be downloaded. Tests point it at their own server. */
  models?: ModelList
  /** Replaces the transcriber chosen by `NIGHTJAR_TRANSCRIBER`. */
  transcriber?: TranscriberFactory
  jobs?: JobsOptions
}

/**
 * Listens right away so `/healthz` and `/readyz` answer while migrations run.
 * `ready` settles once migrations are done and the worker is up.
 */
export async function start({
  config,
  logger,
  migrationsFolder,
  exit,
  models = supportedModels,
  transcriber,
  jobs: jobsOptions,
}: StartOptions) {
  const database = createDatabase(config.DATABASE_URL, logger)
  const readiness = createReadiness(database.ping)
  const metrics = createMetrics()
  const storage = createStorage(config.NIGHTJAR_DATA_DIR)
  const events = createEvents({ databaseUrl: config.DATABASE_URL, database, logger })
  const jobs = createJobs(config.DATABASE_URL, logger, jobsOptions)
  const transcription = createTranscriptionService({
    database,
    storage,
    jobs,
    events,
    logger,
    models,
  })
  const model = defaultModel(models)
  const createTranscriber: TranscriberFactory =
    transcriber ??
    (config.NIGHTJAR_TRANSCRIBER === 'fake'
      ? createFakeTranscriber().factory
      : () => createSherpaTranscriber(model, storage.localPath(modelKey(model.id))))
  const transcribe = createTranscribeHandler({
    database,
    storage,
    events,
    metrics,
    logger,
    createTranscriber,
    hasQueuedJobs: jobs.hasQueuedJobs,
  })
  let auth: Auth | undefined
  const getAuth = () => {
    if (!auth) throw new Error('auth is not ready')
    return auth
  }

  const web = await startWeb(
    {
      logger,
      readiness,
      metrics,
      database,
      storage,
      events,
      transcription,
      getAuth,
      trustProxy: config.NIGHTJAR_TRUST_PROXY,
      webDir: config.NIGHTJAR_WEB_DIR,
    },
    config.PORT,
  )
  const metricsServer = await startMetricsServer(metrics, config.NIGHTJAR_METRICS_PORT).catch(
    async (error: unknown) => {
      await web.close()
      await database.close()
      throw error
    },
  )
  logger.info({ port: web.port, metricsPort: metricsServer.port }, 'listening')

  let worker: Awaited<ReturnType<typeof startWorker>> | undefined
  const ready = database
    .migrate(migrationsFolder)
    .then(async () => {
      auth = await createAuth(database)
      await issueSetupCode(database, logger)
      await events.start()
      worker = await startWorker({ logger, jobs, metrics, transcribe })
    })
    .then(
      async () => {
        readiness.markMigrated()
        logger.info('migrations done')
        await transcription.resume().catch(() => {
          logger.warn('could not resume transcription')
        })
      },
      (error: unknown) => {
        logger.error({ migrationError: serializeFullError(error as Error) }, 'migrations failed')
        exit(1)
      },
    )

  return {
    appPort: web.port,
    metricsPort: metricsServer.port,
    ready,
    transcription,
    close: async () => {
      await ready
      await worker?.stop()
      await web.close()
      await events.stop()
      await metricsServer.close()
      await database.close()
    },
  }
}
