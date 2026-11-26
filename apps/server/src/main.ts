import { join } from 'node:path'
import { ConfigError, loadConfig } from './config.ts'
import { createLogger, type Logger } from './logger.ts'
import { describeError, installCrashHandlers, installShutdownHandlers } from './process-handlers.ts'
import { start } from './start.ts'

const exit = (code: number) => process.exit(code)
let logger: Logger | undefined

try {
  const config = loadConfig(process.env)
  logger = createLogger({ level: config.LOG_LEVEL })
  installCrashHandlers(process, { logger, exit })
  const server = await start({
    config,
    logger,
    migrationsFolder: join(import.meta.dirname, '../migrations'),
    exit,
  })
  installShutdownHandlers(process, { logger, exit, close: server.close })
} catch (error) {
  if (error instanceof ConfigError) console.error(error.message)
  else logger?.fatal(describeError(error), 'startup failed')
  exit(1)
}
