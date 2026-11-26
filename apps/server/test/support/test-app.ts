import { buildApp } from '../../src/app.ts'
import { createLogger } from '../../src/logger.ts'
import { createMetrics } from '../../src/metrics.ts'
import { createReadiness } from '../../src/readiness.ts'
import { captureLogs } from './log-capture.ts'

export function buildTestApp(
  options: { checkDatabase?: () => Promise<void>; level?: string; webDir?: string } = {},
) {
  const capture = captureLogs()
  const logger = createLogger({ level: options.level ?? 'debug', stream: capture.stream })
  const readiness = createReadiness(options.checkDatabase ?? (() => Promise.resolve()))
  const metrics = createMetrics()
  const app = buildApp({ logger, readiness, metrics, webDir: options.webDir })
  return { app, capture, readiness, metrics }
}
