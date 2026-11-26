import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { e2eServerFiles } from '../../../../e2e/support/server-files.ts'
import { loadConfig } from '../../src/config.ts'
import { createLogger } from '../../src/logger.ts'
import { start } from '../../src/start.ts'
import { startPostgres } from './postgres.ts'

const postgres = await startPostgres()
const config = loadConfig({
  ...process.env,
  DATABASE_URL: postgres.getConnectionUri(),
  NIGHTJAR_TRUST_PROXY: 'true',
})

writeFileSync(e2eServerFiles.databaseUrl, postgres.getConnectionUri())
writeFileSync(e2eServerFiles.log, '')
const logStream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    process.stdout.write(chunk)
    appendFileSync(e2eServerFiles.log, chunk)
    done()
  },
})

await start({
  config,
  logger: createLogger({ level: config.LOG_LEVEL, stream: logStream }),
  migrationsFolder: join(import.meta.dirname, '../../migrations'),
  exit: (code) => process.exit(code),
})
