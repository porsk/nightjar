import { buildApp } from '../../src/app.ts'
import { createDatabase, type Database } from '../../src/database.ts'
import { createLogger } from '../../src/logger.ts'
import { createMetrics } from '../../src/metrics.ts'
import { createSetupCode, type SetupCode } from '../../src/modules/auth/setup-code.ts'
import { createReadiness } from '../../src/readiness.ts'
import { captureLogs } from './log-capture.ts'

export function buildTestApp(
  options: {
    checkDatabase?: () => Promise<void>
    level?: string
    webDir?: string
    database?: Database
    setupCode?: SetupCode
    trustProxy?: boolean
  } = {},
) {
  const capture = captureLogs()
  const logger = createLogger({ level: options.level ?? 'debug', stream: capture.stream })
  const readiness = createReadiness(options.checkDatabase ?? (() => Promise.resolve()))
  const metrics = createMetrics()
  const database = options.database ?? createDatabase('postgres://localhost:1/unused', logger)
  const setupCode = options.setupCode ?? createSetupCode()
  const app = buildApp({
    logger,
    readiness,
    metrics,
    database,
    setupCode,
    trustProxy: options.trustProxy,
    webDir: options.webDir,
  })
  return { app, capture, readiness, metrics, logger, setupCode }
}
