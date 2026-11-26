import { buildApp } from '../../src/app.ts'
import { createDatabase, type Database } from '../../src/database.ts'
import { createLogger } from '../../src/logger.ts'
import { createMetrics } from '../../src/metrics.ts'
import type { Auth } from '../../src/modules/auth/auth.ts'
import { createReadiness } from '../../src/readiness.ts'
import type { Events } from '../../src/events.ts'
import type { TranscriptionService } from '../../src/modules/transcription/service.ts'
import { createStorage, type Storage } from '../../src/storage.ts'
import { captureLogs, type LogCapture } from './log-capture.ts'

/** Stands in where a test does not care about live events and transcription. */
export const inertEvents = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  subscribe: () => () => undefined,
  publishToUser: () => Promise.resolve(),
  publishToAdmins: () => Promise.resolve(),
} satisfies Events

export const inertTranscription = {
  status: () =>
    Promise.resolve({
      enabled: false,
      state: 'off',
      downloadedBytes: 0,
      totalBytes: 0,
      backlogCount: 0,
    } as const),
  setEnabled: () => Promise.reject(new Error('inert transcription')),
  initialStatus: () => Promise.resolve('skipped' as const),
  schedule: () => Promise.resolve(),
  transcribeBacklog: () => Promise.resolve(0),
  resume: () => Promise.resolve(),
  whenIdle: () => Promise.resolve(),
} satisfies TranscriptionService

export async function buildTestApp(
  options: {
    checkDatabase?: () => Promise<void>
    level?: string
    webDir?: string
    database?: Database
    storage?: Storage
    events?: Events
    transcription?: TranscriptionService
    maxUploadBytes?: number
    capture?: LogCapture
    now?: () => Date
    auth?: Auth
    trustProxy?: number
    rateLimitMax?: number
  } = {},
) {
  const capture = options.capture ?? captureLogs()
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
    events: options.events ?? inertEvents,
    transcription: options.transcription ?? inertTranscription,
    maxUploadBytes: options.maxUploadBytes,
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
