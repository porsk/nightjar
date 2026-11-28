import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { e2eServerFiles } from '../../../../e2e/support/server-files.ts'
import { loadConfig } from '../../src/config.ts'
import { createLogger } from '../../src/logger.ts'
import { createFakeTranscriber } from '../../src/modules/transcription/fake-transcriber.ts'
import { start } from '../../src/start.ts'
import { startCloudServer } from './cloud-server.ts'
import { startModelServer } from './model-server.ts'
import { startPostgres } from './postgres.ts'

const postgres = await startPostgres()
const config = loadConfig({
  ...process.env,
  DATABASE_URL: postgres.getConnectionUri(),
  NIGHTJAR_TRUST_PROXY: '1',
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

const modelServer = await startModelServer()
modelServer.behaviour.slowMs = 30
const cloudServer = await startCloudServer()
writeFileSync(e2eServerFiles.cloudUrl, cloudServer.origin)

await start({
  config,
  logger: createLogger({ level: config.LOG_LEVEL, stream: logStream }),
  migrationsFolder: join(import.meta.dirname, '../../migrations'),
  exit: (code) => process.exit(code),
  models: modelServer.list,
  providers: cloudServer.providers(),
  cloud: { pollIntervalMs: 100 },
  transcriber: createFakeTranscriber({ delayMs: 1500 }).factory,
  jobs: { pollingIntervalSeconds: 0.5, retryDelaySeconds: 1 },
})
