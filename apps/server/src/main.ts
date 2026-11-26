import { join } from 'node:path'
import { ConfigError, loadConfig } from './config.ts'
import { createLogger } from './logger.ts'
import { start } from './start.ts'

try {
  const config = loadConfig(process.env)
  const logger = createLogger({ level: config.LOG_LEVEL })
  await start({
    config,
    logger,
    migrationsFolder: join(import.meta.dirname, '../migrations'),
    exit: (code) => process.exit(code),
  })
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'Startup failed')
  process.exit(1)
}
