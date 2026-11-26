import type { Config } from './config.ts'
import { createDatabase } from './database.ts'
import { serializeFullError, type Logger } from './logger.ts'
import { createSetupCode } from './modules/auth/setup-code.ts'
import { createMetrics, startMetricsServer } from './metrics.ts'
import { createReadiness } from './readiness.ts'
import { startWeb } from './web.ts'
import { startWorker } from './worker.ts'

export interface StartOptions {
  config: Config
  logger: Logger
  migrationsFolder: string
  exit: (code: number) => void
}

/**
 * Listens right away so `/healthz` and `/readyz` answer while migrations run.
 * `ready` settles once migrations are done and the worker is up.
 */
export async function start({ config, logger, migrationsFolder, exit }: StartOptions) {
  const database = createDatabase(config.DATABASE_URL, logger)
  const readiness = createReadiness(database.ping)
  const metrics = createMetrics()
  const setupCode = createSetupCode()

  const web = await startWeb(
    {
      logger,
      readiness,
      metrics,
      database,
      setupCode,
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

  let worker: ReturnType<typeof startWorker> | undefined
  const ready = database
    .migrate(migrationsFolder)
    .then(() => setupCode.issueIfNoAccount(database, logger))
    .then(
      () => {
        readiness.markMigrated()
        logger.info('migrations done')
        worker = startWorker({ logger })
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
    close: async () => {
      await ready
      await worker?.stop()
      await web.close()
      await metricsServer.close()
      await database.close()
    },
  }
}
