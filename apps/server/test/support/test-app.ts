import { buildApp } from '../../src/app.ts'
import { createDatabase, type Database } from '../../src/database.ts'
import { createLogger } from '../../src/logger.ts'
import { createMetrics } from '../../src/metrics.ts'
import type { Auth } from '../../src/modules/auth/auth.ts'
import { createReadiness } from '../../src/readiness.ts'
import { createStorage, type Storage } from '../../src/storage.ts'
import { captureLogs } from './log-capture.ts'

export async function buildTestApp(
  options: {
    checkDatabase?: () => Promise<void>
    level?: string
    webDir?: string
    database?: Database
    storage?: Storage
    now?: () => Date
    auth?: Auth
    trustProxy?: number
    rateLimitMax?: number
  } = {},
) {
  const capture = captureLogs()
  const logger = createLogger({ level: options.level ?? 'debug', stream: capture.stream })
  const readiness = createReadiness(options.checkDatabase ?? (() => Promise.resolve()))
  const metrics = createMetrics()
  const database = options.database ?? createDatabase('postgres://localhost:1/unused', logger)
  const app = await buildApp({
    logger,
    readiness,
    metrics,
    database,
    storage: options.storage ?? createStorage('/unused'),
    now: options.now,
    getAuth: () => {
      if (!options.auth) throw new Error('this test app has no auth')
      return options.auth
    },
    trustProxy: options.trustProxy,
    rateLimitMax: options.rateLimitMax,
    webDir: options.webDir,
  })
  return { app, capture, readiness, metrics, logger }
}
