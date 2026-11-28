import type { Config } from './config.ts'
import { createDatabase } from './database.ts'
import { createEvents } from './events.ts'
import { createJobs, type JobsOptions } from './jobs.ts'
import { serializeFullError, type Logger } from './logger.ts'
import { createAuth, type Auth } from './modules/auth/auth.ts'
import { issueSetupCode } from './modules/auth/setup-code.ts'
import { createCopyCleaner, createCleanupHandler } from './modules/transcription/cloud/cleanup.ts'
import type { CloudProvider } from './modules/transcription/cloud/provider.ts'
import { cloudProviders } from './modules/transcription/cloud/registry.ts'
import { createKeyStore } from './modules/transcription/cloud/key-store.ts'
import {
  createSecretBox,
  InstanceSecretError,
  resolveInstanceSecret,
} from './modules/transcription/cloud/secrets.ts'
import { createEngineFactory } from './modules/transcription/engines.ts'
import { createFakeTranscriber } from './modules/transcription/fake-transcriber.ts'
import { modelById, supportedModels, type ModelList } from './modules/transcription/models.ts'
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
  /** Replaces the cloud providers. Tests point them at their own server. */
  providers?: CloudProvider[]
  /** Timings of the cloud pipeline, for tests. */
  cloud?: {
    pollIntervalMs?: number
    partDeadlineMs?: (partDurationMs: number) => number
    cleanupMinAgeMs?: number
  }
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
  providers = cloudProviders,
  cloud,
}: StartOptions) {
  const instanceSecret = await resolveInstanceSecret({
    env: config.NIGHTJAR_SECRET_KEY,
    dataDir: config.NIGHTJAR_DATA_DIR,
    logger,
  }).catch((error: unknown) => {
    if (error instanceof InstanceSecretError) {
      logger.fatal({ source: error.source }, error.message)
    }
    throw error
  })
  const database = createDatabase(config.DATABASE_URL, logger)
  const readiness = createReadiness(database.ping)
  const metrics = createMetrics()
  const storage = createStorage(config.NIGHTJAR_DATA_DIR)
  const events = createEvents({ databaseUrl: config.DATABASE_URL, database, logger })
  const jobs = createJobs(config.DATABASE_URL, logger, jobsOptions)
  const keys = createKeyStore(database, createSecretBox(instanceSecret))
  const transcription = createTranscriptionService({
    database,
    storage,
    jobs,
    events,
    logger,
    models,
    providers,
    keys,
  })
  const cleaner = createCopyCleaner({
    database,
    keys,
    providers,
    logger,
    fetch,
    ...(cloud?.cleanupMinAgeMs === undefined ? {} : { minAgeMs: cloud.cleanupMinAgeMs }),
  })
  const local: TranscriberFactory =
    transcriber ??
    (config.NIGHTJAR_TRANSCRIBER === 'fake'
      ? createFakeTranscriber().factory
      : (id) => createSherpaTranscriber(modelById(models, id), storage.localPath(modelKey(id))))
  const createTranscriber = createEngineFactory(
    providers,
    {
      database,
      storage,
      keys,
      cleaner,
      fetch,
      queueCleanup: jobs.enqueueCloudCleanup,
      ...(cloud?.pollIntervalMs === undefined ? {} : { pollIntervalMs: cloud.pollIntervalMs }),
      ...(cloud?.partDeadlineMs === undefined ? {} : { partDeadlineMs: cloud.partDeadlineMs }),
    },
    local,
  )
  const transcribe = createTranscribeHandler({
    database,
    storage,
    events,
    metrics,
    logger,
    createTranscriber,
    models,
    providers,
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
      providers,
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
      worker = await startWorker({
        logger,
        jobs,
        metrics,
        transcribe,
        cleanup: createCleanupHandler({ cleaner, logger }),
      })
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
