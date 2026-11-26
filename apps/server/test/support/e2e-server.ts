import { join } from 'node:path'
import { loadConfig } from '../../src/config.ts'
import { createLogger } from '../../src/logger.ts'
import { start } from '../../src/start.ts'
import { startPostgres } from './postgres.ts'

const postgres = await startPostgres()
const config = loadConfig({ ...process.env, DATABASE_URL: postgres.getConnectionUri() })

await start({
  config,
  logger: createLogger({ level: config.LOG_LEVEL }),
  migrationsFolder: join(import.meta.dirname, '../../migrations'),
  exit: (code) => process.exit(code),
})
