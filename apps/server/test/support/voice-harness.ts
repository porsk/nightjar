import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { liveEventSchema, type LiveEvent } from '@nightjar/shared/recordings'
import { eq } from 'drizzle-orm'
import { expect } from 'vitest'
import type { Database } from '../../src/database.ts'
import { cloudCopies, instanceSettings, providerSecrets, recordings } from '../../src/db/schema.ts'
import { createEvents } from '../../src/events.ts'
import { createJobs, type JobsOptions } from '../../src/jobs.ts'
import { createLogger } from '../../src/logger.ts'
import { createAuth } from '../../src/modules/auth/auth.ts'
import {
  createCleanupHandler,
  createCopyCleaner,
} from '../../src/modules/transcription/cloud/cleanup.ts'
import type { CloudProvider } from '../../src/modules/transcription/cloud/provider.ts'
import { createKeyStore } from '../../src/modules/transcription/cloud/key-store.ts'
import {
  createSecretBox,
  resolveInstanceSecret,
} from '../../src/modules/transcription/cloud/secrets.ts'
import { createEngineFactory } from '../../src/modules/transcription/engines.ts'
import {
  createFakeTranscriber,
  type FakeTranscriberOptions,
} from '../../src/modules/transcription/fake-transcriber.ts'
import { createTranscriptionService } from '../../src/modules/transcription/service.ts'
import { createTranscribeHandler } from '../../src/modules/transcription/transcribe-job.ts'
import type { TranscriberFactory } from '../../src/modules/transcription/transcriber.ts'
import { createStorage } from '../../src/storage.ts'
import { startWorker } from '../../src/worker.ts'
import { captureLogs } from './log-capture.ts'
import { startCloudServer, type CloudServer } from './cloud-server.ts'
import { modelFilesOf, startModelServer, testModelId, type ModelServer } from './model-server.ts'
import { buildTestApp } from './test-app.ts'
import { createUserWithSession, signInExistingUser } from './users.ts'

const fixtures = join(import.meta.dirname, '../../../../e2e/fixtures')
export const enWav = readFileSync(join(fixtures, 'en-sample.wav'))
export const huWav = readFileSync(join(fixtures, 'hu-sample.wav'))

/** Puts every setting about transcription back to a fresh install. */
export const resetInstanceSettings = async (database: Database) => {
  await database.db.update(instanceSettings).set({
    transcriptionEnabled: false,
    activeEngine: testModelId,
    modelDownloadState: 'idle',
    modelDownloadedBytes: 0,
    modelDownloadId: null,
    modelDownloadUse: false,
    modelDownloadError: null,
  })
  await database.db.delete(providerSecrets)
  await database.db.delete(cloudCopies)
}

export const wavSeconds = (wav: Buffer) => (wav.length - 44) / 32000

export function multipart(fields: Record<string, string>, file: { data: Buffer; name: string }) {
  const boundary = `----nightjar${randomUUID()}`
  const text = Object.entries(fields)
    .map(
      ([key, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    )
    .join('')
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: audio/mp4\r\n\r\n`
  return {
    payload: Buffer.concat([
      Buffer.from(text + head),
      file.data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

export async function waitFor<T>(
  check: () => Promise<T | false | undefined> | T | false | undefined,
  what: string,
) {
  const deadline = Date.now() + 20_000
  for (;;) {
    const value = await check()
    if (value !== false && value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** A finished download still holds the download slot until the final save, so wait for that before acting on the model. */
export const waitForDownloadSlotFree = (database: Database) =>
  waitFor(async () => {
    const [saved] = await database.db.select().from(instanceSettings)
    return saved?.modelDownloadId === null && saved.modelDownloadState === 'idle'
  }, 'the download slot to be cleared')

/** The server pieces of a voice test: app, worker, fake transcriber, model server and two users. */
export function createVoiceHarness(context: {
  postgres: () => StartedPostgreSqlContainer
  database: () => Database
  cleanups: (() => Promise<void>)[]
}) {
  const { cleanups } = context
  interface LaunchOptions {
    fake?: FakeTranscriberOptions
    /** Wraps the fake transcriber factory, for tests that make loading a model fail. */
    wrapFactory?: (factory: TranscriberFactory) => TranscriberFactory
    maxUploadBytes?: number
    dataDir?: string
    modelServer?: ModelServer
    now?: Date
    sameUsers?: boolean
    /** Vendor fixture to use. A new one is started when none is given. */
    cloudServer?: CloudServer
    /** Replaces the providers, for tests that need another limit. They should point at the fixture server. */
    providers?: (server: CloudServer) => CloudProvider[]
    jobs?: JobsOptions
    cloud?: {
      pollIntervalMs?: number
      partDeadlineMs?: (partDurationMs: number) => number
      cleanupMinAgeMs?: number
      now?: () => Date
    }
    /** Replaces `NIGHTJAR_SECRET_KEY`, for tests that stand in for a changed secret. */
    secretKey?: string
  }

  async function launch(options: LaunchOptions = {}) {
    const database = context.database()
    const capture = captureLogs()
    const logger = createLogger({ level: 'debug', stream: capture.stream })
    const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'nightjar-data-')))
    const storage = createStorage(dataDir)
    const url = context.postgres().getConnectionUri()
    const events = createEvents({ databaseUrl: url, database, logger })
    const jobs = createJobs(url, logger, {
      retryDelaySeconds: 1,
      cleanupRetryDelaySeconds: 1,
      pollingIntervalSeconds: 0.5,
      ...options.jobs,
    })
    const modelServer = options.modelServer ?? (await startModelServer())
    const cloudServer = options.cloudServer ?? (await startCloudServer())
    if (!options.cloudServer) cleanups.push(cloudServer.close)
    const providers = options.providers?.(cloudServer) ?? cloudServer.providers()
    const instanceSecret = await resolveInstanceSecret({
      env: options.secretKey,
      dataDir,
      logger,
    })
    const keys = createKeyStore(database, createSecretBox(instanceSecret))
    const transcription = createTranscriptionService({
      database,
      storage,
      jobs,
      events,
      logger,
      models: modelServer.list,
      providers,
      keys,
      now: () => options.now ?? new Date('2026-11-26T20:30:00Z'),
    })
    const cleaner = createCopyCleaner({
      database,
      keys,
      providers,
      logger,
      fetch,
      minAgeMs: options.cloud?.cleanupMinAgeMs ?? 0,
      ...(options.cloud?.now ? { now: options.cloud.now } : {}),
    })
    const fake = createFakeTranscriber(options.fake)
    const auth = await createAuth(database)
    const test = await buildTestApp({
      database,
      auth,
      storage,
      events,
      transcription,
      providers,
      capture,
      maxUploadBytes: options.maxUploadBytes,
      now: () => options.now ?? new Date('2026-11-26T20:30:00Z'),
    })
    test.readiness.markMigrated()
    const handler = createTranscribeHandler({
      database,
      storage,
      events,
      metrics: test.metrics,
      logger: test.logger,
      createTranscriber: createEngineFactory(
        providers,
        {
          database,
          storage,
          keys,
          cleaner,
          fetch,
          queueCleanup: jobs.enqueueCloudCleanup,
          pollIntervalMs: options.cloud?.pollIntervalMs ?? 20,
          ...(options.cloud?.partDeadlineMs
            ? { partDeadlineMs: options.cloud.partDeadlineMs }
            : {}),
        },
        options.wrapFactory?.(fake.factory) ?? fake.factory,
      ),
      models: modelServer.list,
      providers,
      hasQueuedJobs: jobs.hasQueuedJobs,
    })
    await events.start()
    const worker = await startWorker({
      logger: test.logger,
      jobs,
      metrics: test.metrics,
      transcribe: handler,
      cleanup: createCleanupHandler({ cleaner, logger: test.logger }),
    })
    await test.app.ready()
    await transcription.resume()

    const alice = options.sameUsers
      ? await signInExistingUser(database, auth, 'alice')
      : await createUserWithSession(database, auth, {
          username: 'alice',
          timeZone: 'Europe/Budapest',
          isAdmin: true,
        })
    const bob = options.sameUsers
      ? await signInExistingUser(database, auth, 'bob')
      : await createUserWithSession(database, auth, {
          username: 'bob',
          timeZone: 'Europe/Budapest',
        })
    const streams: AbortController[] = []
    let closed = false
    const shutdown = async () => {
      if (closed) return
      closed = true
      for (const stream of streams) stream.abort()
      await test.app.close()
      await worker.stop()
      await events.stop()
      if (!options.modelServer) await modelServer.close()
    }
    cleanups.push(shutdown)

    const call = (
      user: { cookie: string } | null,
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: string,
      payload?: object,
      headers: Record<string, string> = {},
    ) =>
      test.app.inject({
        method,
        url: path,
        headers: { ...(user ? { cookie: user.cookie } : {}), ...headers },
        ...(payload ? { payload } : {}),
      })

    const upload = (
      user: { cookie: string },
      fields: Record<string, string>,
      file: { data: Buffer; name: string } = { data: enWav, name: 'memo.wav' },
    ) => {
      const { payload, headers } = multipart(fields, file)
      return test.app.inject({
        method: 'POST',
        url: '/api/v1/recordings',
        headers: { cookie: user.cookie, ...headers },
        payload,
      })
    }

    const uploadVoice = async (
      user: { cookie: string },
      fields: Record<string, string> = { language: 'en', entryDate: '2026-11-26' },
      file?: { data: Buffer; name: string },
    ) => {
      const response = await upload(user, fields, file)
      expect(response.statusCode).toBe(201)
      return response.json<{ id: string; entryId: string; status: string }>()
    }

    const seedModel = async (modelId = testModelId) => {
      const folder = join(dataDir, 'models', modelId)
      await mkdir(folder, { recursive: true })
      for (const [name, data] of Object.entries(modelFilesOf[modelId] ?? {})) {
        await writeFile(join(folder, name), data)
      }
    }

    const statusOf = async (id: string) =>
      (await database.db.select().from(recordings).where(eq(recordings.id, id)))[0]?.status

    const hubEvents = (userId: string, isAdmin = false) => {
      const seen: LiveEvent[] = []
      const stop = events.subscribe({
        userId,
        isAdmin,
        send: (event) => seen.push(event),
        end: () => undefined,
      })
      cleanups.push(() => {
        stop()
        return Promise.resolve()
      })
      return seen
    }

    const openStream = async (user: { cookie: string }) => {
      const address = await test.app.listen({ port: 0, host: '127.0.0.1' }).catch(() => undefined)
      const base =
        address ??
        `http://127.0.0.1:${String((test.app.server.address() as { port: number }).port)}`
      const controller = new AbortController()
      streams.push(controller)
      const response = await fetch(`${base}/api/v1/events`, {
        headers: { cookie: user.cookie },
        signal: controller.signal,
      })
      const seen: LiveEvent[] = []
      const state = { ended: false }
      void (async () => {
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          for (;;) {
            const next = await reader?.read()
            if (!next || next.done) {
              state.ended = true
              return
            }
            buffer += decoder.decode(next.value, { stream: true })
            for (const block of buffer.split('\n\n').slice(0, -1)) {
              const data = block.split('\n').find((line) => line.startsWith('data: '))
              if (data) seen.push(liveEventSchema.parse(JSON.parse(data.slice(6))))
            }
            buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2)
          }
        } catch {
          // the test closed the stream
        }
      })()
      return {
        seen,
        state,
        status: response.status,
        contentType: response.headers.get('content-type'),
      }
    }

    return {
      ...test,
      alice,
      bob,
      call,
      upload,
      uploadVoice,
      seedModel,
      statusOf,
      hubEvents,
      openStream,
      fake,
      jobs,
      transcription,
      events,
      modelServer,
      cloudServer,
      providers,
      keys,
      dataDir,
      storage,
      shutdown,
    }
  }

  const launchAgain = async (
    previous: Awaited<ReturnType<typeof launch>>,
    options: LaunchOptions = {},
  ) => {
    await previous.shutdown()
    return launch({
      dataDir: previous.dataDir,
      modelServer: previous.modelServer,
      cloudServer: previous.cloudServer,
      sameUsers: true,
      ...options,
    })
  }

  const enableTranscription = async (app: Awaited<ReturnType<typeof launch>>) => {
    await app.seedModel()
    const modelEvents = app.hubEvents(app.alice.id, true)
    const response = await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', {
      enabled: true,
    })
    expect(response.statusCode).toBe(200)
    await waitFor(
      async () =>
        (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{ state: string }>()
          .state === 'ready',
      'ready model',
    )
    await waitFor(
      () => modelEvents.some((event) => event.type === 'model.updated' && event.state === 'ready'),
      'the ready event',
    )
  }

  const doneStatus = (app: Awaited<ReturnType<typeof launch>>, id: string) =>
    waitFor(async () => (await app.statusOf(id)) === 'done', 'done recording')

  return { launch, launchAgain, enableTranscription, doneStatus }
}
