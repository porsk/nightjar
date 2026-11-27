import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { liveEventSchema, maxUploadBytes, type LiveEvent } from '@nightjar/shared/recordings'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { entries, instanceSettings, recordings, transcripts } from '../src/db/schema.ts'
import { createEvents } from '../src/events.ts'
import { createJobs, transcribeQueue } from '../src/jobs.ts'
import { createLogger } from '../src/logger.ts'
import { createAuth } from '../src/modules/auth/auth.ts'
import {
  createFakeTranscriber,
  fakeTexts,
  type FakeTranscriberOptions,
} from '../src/modules/transcription/fake-transcriber.ts'
import { createTranscriptionService } from '../src/modules/transcription/service.ts'
import { createTranscribeHandler } from '../src/modules/transcription/transcribe-job.ts'
import { createStorage } from '../src/storage.ts'
import { startWorker } from '../src/worker.ts'
import { captureLogs, expectNoMarkersInLogs } from './support/log-capture.ts'
import {
  modelFiles,
  startModelServer,
  testModelId,
  type ModelServer,
} from './support/model-server.ts'
import { startPostgres } from './support/postgres.ts'
import { buildTestApp } from './support/test-app.ts'
import { createUserWithSession, signInExistingUser } from './support/users.ts'

const fixtures = join(import.meta.dirname, '../../../e2e/fixtures')
const enWav = readFileSync(join(fixtures, 'en-sample.wav'))
const huWav = readFileSync(join(fixtures, 'hu-sample.wav'))
const wavSeconds = (wav: Buffer) => (wav.length - 44) / 32000
const marker = 'ZQX-PRIVATE-7781'

function multipart(fields: Record<string, string>, file: { data: Buffer; name: string }) {
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

async function waitFor<T>(
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

function makeAudio(extension: string, codec: string) {
  const folder = mkdtempSync(join(tmpdir(), 'nightjar-audio-'))
  const path = join(folder, `sound.${extension}`)
  const result = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    codec,
    path,
  ])
  if (result.status !== 0) throw new Error(`ffmpeg could not make ${extension}`)
  return readFileSync(path)
}

describe('003-voice-entries: voice entries API against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer
  let database: Database
  const cleanups: (() => Promise<void>)[] = []

  beforeAll(async () => {
    postgres = await startPostgres()
    database = createDatabase(postgres.getConnectionUri(), createLogger({ level: 'silent' }))
    await database.migrate(join(import.meta.dirname, '../migrations'))
  })

  afterAll(async () => {
    await database.close()
    await postgres.stop()
  })

  beforeEach(async () => {
    await database.db.execute(sql`truncate users cascade`)
    await database.db.update(instanceSettings).set({ transcriptionEnabled: false })
    await database.db.execute(sql`drop schema if exists pgboss cascade`)
  })

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  interface LaunchOptions {
    fake?: FakeTranscriberOptions
    maxUploadBytes?: number
    dataDir?: string
    modelServer?: ModelServer
    now?: Date
    sameUsers?: boolean
  }

  async function launch(options: LaunchOptions = {}) {
    const capture = captureLogs()
    const logger = createLogger({ level: 'debug', stream: capture.stream })
    const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'nightjar-data-')))
    const storage = createStorage(dataDir)
    const url = postgres.getConnectionUri()
    const events = createEvents({ databaseUrl: url, database, logger })
    const jobs = createJobs(url, logger, { retryDelaySeconds: 1, pollingIntervalSeconds: 0.5 })
    const modelServer = options.modelServer ?? (await startModelServer())
    const transcription = createTranscriptionService({
      database,
      storage,
      jobs,
      events,
      logger,
      models: modelServer.list,
    })
    const fake = createFakeTranscriber(options.fake)
    const auth = await createAuth(database)
    const test = await buildTestApp({
      database,
      auth,
      storage,
      events,
      transcription,
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
      createTranscriber: fake.factory,
      hasQueuedJobs: jobs.hasQueuedJobs,
    })
    await events.start()
    const worker = await startWorker({
      logger: test.logger,
      jobs,
      metrics: test.metrics,
      transcribe: handler,
    })
    await test.app.ready()
    await transcription.resume()

    const alice = options.sameUsers
      ? await signInExistingUser(database, auth, 'alice@example.test')
      : await createUserWithSession(database, auth, {
          email: 'alice@example.test',
          timeZone: 'Europe/Budapest',
          isAdmin: true,
        })
    const bob = options.sameUsers
      ? await signInExistingUser(database, auth, 'bob@example.test')
      : await createUserWithSession(database, auth, {
          email: 'bob@example.test',
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

    const seedModel = async () => {
      const folder = join(dataDir, 'models', testModelId)
      await mkdir(folder, { recursive: true })
      for (const [name, data] of Object.entries(modelFiles)) {
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
      dataDir,
      storage,
      shutdown,
    }
  }

  const launchAgain = async (previous: Awaited<ReturnType<typeof launch>>) => {
    await previous.shutdown()
    return launch({
      dataDir: previous.dataDir,
      modelServer: previous.modelServer,
      sameUsers: true,
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

  describe('uploading and storing audio', () => {
    it('AC-9: accepts webm, ogg, m4a, mp3, wav and flac by content', async () => {
      const app = await launch()
      const samples: [string, Buffer][] = [
        ['webm', makeAudio('webm', 'libopus')],
        ['ogg', makeAudio('ogg', 'libopus')],
        ['m4a', makeAudio('m4a', 'aac')],
        ['mp3', makeAudio('mp3', 'libmp3lame')],
        ['wav', enWav],
        ['flac', makeAudio('flac', 'flac')],
      ]
      for (const [extension, data] of samples) {
        const response = await app.upload(
          app.alice,
          { language: 'en', entryDate: '2026-11-26' },
          { data, name: `memo.${extension}` },
        )
        expect(response.statusCode, extension).toBe(201)
        const stored = await database.db
          .select()
          .from(recordings)
          .where(eq(recordings.id, response.json<{ id: string }>().id))
        expect(stored[0]?.filePath.endsWith(`.${extension}`), extension).toBe(true)
        expect(stored[0]?.durationMs, extension).toBeGreaterThan(800)
      }
    })

    it('AC-9: refuses a picture renamed to .m4a with 415 and leaves nothing behind', async () => {
      const app = await launch()
      const picture = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
        Buffer.from('JFIF'),
        Buffer.alloc(2000),
      ])
      const response = await app.upload(
        app.alice,
        { language: 'en', entryDate: '2026-11-26' },
        { data: picture, name: 'voice.m4a' },
      )
      expect(response.statusCode).toBe(415)
      expect(response.json()).toMatchObject({ error: { code: 'unsupported_audio' } })
      expect(await database.db.select().from(entries)).toHaveLength(0)
      expect(await database.db.select().from(recordings)).toHaveLength(0)
      expect(existsSync(join(app.dataDir, 'media'))).toBe(false)
      expect(
        !existsSync(join(app.dataDir, 'tmp')) || readdirSync(join(app.dataDir, 'tmp')).length === 0,
      ).toBe(true)
    })

    it('AC-9: refuses a file with an audio header but no audio inside', async () => {
      const app = await launch()
      const broken = Buffer.concat([
        Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE'),
        Buffer.alloc(100, 7),
      ])
      const response = await app.upload(
        app.alice,
        { language: 'en', entryDate: '2026-11-26' },
        { data: broken, name: 'broken.wav' },
      )
      expect(response.statusCode).toBe(415)
      expect(await database.db.select().from(recordings)).toHaveLength(0)
    })

    it('AC-9: refuses a file over the limit with 413 and leaves nothing behind', async () => {
      expect(maxUploadBytes).toBe(200 * 1024 * 1024)
      const app = await launch({ maxUploadBytes: 20_000 })
      const response = await app.upload(app.alice, { language: 'en', entryDate: '2026-11-26' })
      expect(response.statusCode).toBe(413)
      expect(response.json()).toMatchObject({ error: { code: 'file_too_large' } })
      expect(await database.db.select().from(entries)).toHaveLength(0)
      expect(await database.db.select().from(recordings)).toHaveLength(0)
      expect(existsSync(join(app.dataDir, 'media'))).toBe(false)
      expect(
        !existsSync(join(app.dataDir, 'tmp')) || readdirSync(join(app.dataDir, 'tmp')).length === 0,
      ).toBe(true)
    })

    it('AC-9: asks for a language and exactly one of entryId and entryDate', async () => {
      const app = await launch()
      const badFields: Record<string, string>[] = [
        { language: 'en' },
        { language: 'en', entryDate: '2026-11-26', entryId: randomUUID() },
        { entryDate: '2026-11-26' },
        { language: 'fr', entryDate: '2026-11-26' },
      ]
      for (const fields of badFields) {
        expect((await app.upload(app.alice, fields)).statusCode).toBe(400)
      }
      const future = await app.upload(app.alice, { language: 'en', entryDate: '2026-11-28' })
      expect(future.statusCode).toBe(400)
      expect(future.json()).toMatchObject({ error: { code: 'invalid_entry_date' } })
      expect((await app.call(null, 'POST', '/api/v1/recordings')).statusCode).toBe(401)
    })

    it('AC-10: keeps the original bytes under the user folder, measures the length and forgets the file name', async () => {
      const app = await launch()
      const saved = await app.uploadVoice(
        app.alice,
        { language: 'hu', entryDate: '2026-11-25' },
        { data: huWav, name: `${marker}.wav` },
      )
      const [row] = await database.db.select().from(recordings).where(eq(recordings.id, saved.id))
      expect(row?.filePath).toBe(`media/${app.alice.id}/recordings/${saved.id}.wav`)
      expect(readFileSync(join(app.dataDir, row?.filePath ?? '')).equals(huWav)).toBe(true)
      expect(Math.abs((row?.durationMs ?? 0) - wavSeconds(huWav) * 1000)).toBeLessThan(100)
      expect(row?.mimeType).toBe('audio/wav')
      expect(row?.sizeBytes).toBe(huWav.length)
      const everything = await database.db.execute(
        sql`select (select string_agg(to_jsonb(r)::text, ' ') from recordings r) || (select string_agg(to_jsonb(e)::text, ' ') from entries e) as text`,
      )
      expect(JSON.stringify(everything.rows)).not.toContain(marker)
      const [entry] = await database.db.select().from(entries)
      expect(entry?.entryDate).toBe('2026-11-25')
    })

    it('AC-3: a recording without an entry makes a new entry for the day, one with an entry id joins it', async () => {
      const app = await launch()
      const first = await app.uploadVoice(app.alice, { language: 'en', entryDate: '2026-11-26' })
      const second = await app.uploadVoice(app.alice, { language: 'en', entryId: first.entryId })
      expect(second.entryId).toBe(first.entryId)
      expect(await database.db.select().from(entries)).toHaveLength(1)
      const list = await app.call(app.alice, 'GET', `/api/v1/entries/${first.entryId}/recordings`)
      expect(list.json<{ id: string }[]>().map((item) => item.id)).toEqual([first.id, second.id])
    })
  })

  describe('playing audio', () => {
    it('AC-19: sends the original bytes with the stored type and answers range requests', async () => {
      const app = await launch()
      const saved = await app.uploadVoice(app.alice)
      const full = await app.call(app.alice, 'GET', `/api/v1/recordings/${saved.id}/audio`)
      expect(full.statusCode).toBe(200)
      expect(full.headers['content-type']).toBe('audio/wav')
      expect(full.headers['accept-ranges']).toBe('bytes')
      expect(full.rawPayload.equals(enWav)).toBe(true)

      const part = await app.call(
        app.alice,
        'GET',
        `/api/v1/recordings/${saved.id}/audio`,
        undefined,
        { range: 'bytes=0-99' },
      )
      expect(part.statusCode).toBe(206)
      expect(part.headers['content-range']).toBe(`bytes 0-99/${String(enWav.length)}`)
      expect(part.rawPayload.equals(enWav.subarray(0, 100))).toBe(true)

      const tail = await app.call(
        app.alice,
        'GET',
        `/api/v1/recordings/${saved.id}/audio`,
        undefined,
        { range: 'bytes=-50' },
      )
      expect(tail.statusCode).toBe(206)
      expect(tail.rawPayload.equals(enWav.subarray(enWav.length - 50))).toBe(true)

      const open = await app.call(
        app.alice,
        'GET',
        `/api/v1/recordings/${saved.id}/audio`,
        undefined,
        { range: `bytes=${String(enWav.length - 10)}-` },
      )
      expect(open.statusCode).toBe(206)
      expect(open.rawPayload).toHaveLength(10)

      const outside = await app.call(
        app.alice,
        'GET',
        `/api/v1/recordings/${saved.id}/audio`,
        undefined,
        { range: `bytes=${String(enWav.length + 5)}-` },
      )
      expect(outside.statusCode).toBe(416)
      expect(outside.headers['content-range']).toBe(`bytes */${String(enWav.length)}`)
    })
  })

  describe('transcribing in the background', () => {
    it('AC-11: a recording goes pending, transcribing, done, stores the transcript and removes the temp WAV', async () => {
      const app = await launch()
      await enableTranscription(app)
      const seen = app.hubEvents(app.alice.id)
      const saved = await app.uploadVoice(
        app.alice,
        { language: 'hu', entryDate: '2026-11-26' },
        { data: huWav, name: 'a.wav' },
      )
      expect(saved.status).toBe('pending')
      await doneStatus(app, saved.id)
      await waitFor(
        () => seen.some((event) => event.type === 'recording.updated' && event.status === 'done'),
        'the done event',
      )
      const statuses = seen
        .filter((event) => event.type === 'recording.updated')
        .map((event) => event.status)
      expect(statuses).toEqual(['pending', 'transcribing', 'done'])
      const [transcript] = await database.db
        .select()
        .from(transcripts)
        .where(eq(transcripts.recordingId, saved.id))
      expect(transcript).toMatchObject({
        model: 'fake',
        language: 'hu',
        text: fakeTexts.hu,
        isUserEdited: false,
      })
      const tmp = join(app.dataDir, 'tmp')
      expect(!existsSync(tmp) || readdirSync(tmp).length === 0).toBe(true)
    })

    it('AC-12: the event stream of the owner carries the status changes in order', async () => {
      const app = await launch()
      await enableTranscription(app)
      const stream = await app.openStream(app.alice)
      expect(stream.status).toBe(200)
      expect(stream.contentType).toContain('text/event-stream')
      const saved = await app.uploadVoice(app.alice)
      await waitFor(
        () =>
          stream.seen.some(
            (event) => event.type === 'recording.updated' && event.status === 'done',
          ),
        'the done event',
      )
      expect(
        stream.seen.map((event) =>
          event.type === 'recording.updated' ? event.status : event.type,
        ),
      ).toEqual(['pending', 'transcribing', 'done'])
      expect(stream.seen[0]).toMatchObject({ recordingId: saved.id, entryId: saved.entryId })
    })

    it('AC-13: three queued recordings run one at a time, in the order they were saved', async () => {
      const app = await launch()
      await enableTranscription(app)
      const seen = app.hubEvents(app.alice.id)
      const release = app.fake.holdJobs()
      const ids = [
        (await app.uploadVoice(app.alice)).id,
        (await app.uploadVoice(app.alice)).id,
        (await app.uploadVoice(app.alice)).id,
      ]
      await waitFor(() => app.fake.state.parallel === 1, 'the first job to start')
      release()
      await Promise.all(ids.map((id) => doneStatus(app, id)))
      expect(app.fake.state.maxParallel).toBe(1)
      const finished = () =>
        seen.flatMap((event) =>
          event.type === 'recording.updated' && event.status === 'done' ? [event.recordingId] : [],
        )
      await waitFor(() => finished().length === ids.length, 'the done events')
      expect(finished()).toEqual(ids)
    })

    it('AC-14: the model is created when work starts and released when the queue is empty', async () => {
      const app = await launch()
      await enableTranscription(app)
      expect(app.fake.state.liveInstances).toBe(0)
      const release = app.fake.holdJobs()
      const first = await app.uploadVoice(app.alice)
      const second = await app.uploadVoice(app.alice)
      await waitFor(() => app.fake.state.liveInstances === 1, 'a transcriber')
      release()
      await doneStatus(app, first.id)
      await doneStatus(app, second.id)
      await waitFor(() => app.fake.state.liveInstances === 0, 'the transcriber to be released')
      expect(app.fake.state.createdInstances).toBe(1)
    })

    it('AC-15: passes hu and en to the transcriber and stores the detected language for auto', async () => {
      const app = await launch({ fake: { detected: 'hu' } })
      await enableTranscription(app)
      const hu = await app.uploadVoice(app.alice, { language: 'hu', entryDate: '2026-11-26' })
      const en = await app.uploadVoice(app.alice, { language: 'en', entryDate: '2026-11-26' })
      const auto = await app.uploadVoice(app.alice, { language: 'auto', entryDate: '2026-11-26' })
      await Promise.all([hu, en, auto].map((item) => doneStatus(app, item.id)))
      expect(app.fake.state.calls.map((call) => call.language).sort()).toEqual(['auto', 'en', 'hu'])
      const stored = await database.db.select().from(transcripts)
      const byRecording = new Map(stored.map((row) => [row.recordingId, row]))
      expect(byRecording.get(hu.id)?.language).toBe('hu')
      expect(byRecording.get(en.id)?.language).toBe('en')
      expect(byRecording.get(auto.id)?.language).toBe('hu')
      const list = await app.call(app.alice, 'GET', `/api/v1/entries/${auto.entryId}/recordings`)
      expect(list.json<unknown[]>()).toEqual([
        expect.objectContaining({
          language: 'auto',
          transcript: expect.objectContaining({ language: 'hu' }) as unknown,
        }),
      ])
    })

    it('AC-16: retries twice, then fails; the audio stays playable and a retry brings the transcript', async () => {
      const app = await launch()
      await enableTranscription(app)
      app.fake.failNext(3)
      const saved = await app.uploadVoice(app.alice)
      await waitFor(
        async () => (await app.statusOf(saved.id)) === 'failed',
        'the recording to fail',
      )
      expect(app.fake.state.calls).toHaveLength(3)
      expect(
        (await app.call(app.alice, 'GET', `/api/v1/recordings/${saved.id}/audio`)).statusCode,
      ).toBe(200)

      const retried = await app.call(app.alice, 'POST', `/api/v1/recordings/${saved.id}/retry`)
      expect(retried.statusCode).toBe(200)
      expect(retried.json()).toMatchObject({ status: 'pending' })
      await doneStatus(app, saved.id)
      expect(
        (await app.call(app.alice, 'POST', `/api/v1/recordings/${saved.id}/retry`)).statusCode,
      ).toBe(409)
    })

    it('AC-17: saving an edited transcript marks it as edited and the new words are searchable', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      const edited = await app.call(
        app.alice,
        'PATCH',
        `/api/v1/recordings/${saved.id}/transcript`,
        { text: 'Zebrafinch morning walk' },
      )
      expect(edited.statusCode).toBe(200)
      expect(edited.json()).toMatchObject({ text: 'Zebrafinch morning walk', isUserEdited: true })
      const found = await database.db.execute(
        sql`select count(*)::int as total from transcripts where to_tsvector('english', text) @@ plainto_tsquery('english', 'zebrafinch')`,
      )
      expect(found.rows[0]).toMatchObject({ total: 1 })
      expect(
        (
          await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
            text: 5,
          })
        ).statusCode,
      ).toBe(400)
    })

    it('AC-18: a job that runs again leaves the text the user edited alone', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: 'my own words',
      })
      await database.db
        .update(recordings)
        .set({ status: 'pending' })
        .where(eq(recordings.id, saved.id))
      await app.jobs.enqueueTranscription({ userId: app.alice.id, recordingId: saved.id }, 1000)
      await doneStatus(app, saved.id)
      const [transcript] = await database.db
        .select()
        .from(transcripts)
        .where(eq(transcripts.recordingId, saved.id))
      expect(transcript).toMatchObject({ text: 'my own words', isUserEdited: true })
    })

    it('AC-18: a duplicate job for a finished recording does nothing', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      const calls = app.fake.state.calls.length
      await app.jobs.enqueueTranscription({ userId: app.alice.id, recordingId: saved.id }, 1000)
      await waitFor(async () => {
        const duplicates = await app.jobs.boss.findJobs(transcribeQueue, { key: saved.id })
        return duplicates.length === 2 && duplicates.every((job) => job.state === 'completed')
      }, 'the duplicate job to finish')
      expect(app.fake.state.calls).toHaveLength(calls)
    })
  })

  describe('transcription off and on', () => {
    it('AC-20: with transcription off a recording is skipped and no job is queued', async () => {
      const app = await launch()
      const saved = await app.uploadVoice(app.alice)
      expect(saved.status).toBe('skipped')
      expect((await app.jobs.queueDepths())['transcribe']).toBe(0)
      const status = await app.call(app.alice, 'GET', '/api/v1/admin/transcription')
      expect(status.json()).toMatchObject({ enabled: false, state: 'off', backlogCount: 1 })
      const list = await app.call(app.alice, 'GET', `/api/v1/entries/${saved.entryId}/recordings`)
      expect(list.json()).toEqual([
        expect.objectContaining({ status: 'skipped', transcript: null }),
      ])
    })

    it('AC-21: turning it on downloads the model with progress, checks the checksum and moves the files into place', async () => {
      const app = await launch()
      app.modelServer.behaviour.slowMs = 15
      const admin = app.hubEvents(app.alice.id, true)
      const response = await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', {
        enabled: true,
      })
      expect(response.json()).toMatchObject({ enabled: true, state: 'downloading' })

      await waitFor(async () => {
        const status = (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
          downloadedBytes: number
          state: string
        }>()
        return status.state === 'downloading' && status.downloadedBytes > 0
      }, 'progress')
      const folder = join(app.dataDir, 'models')
      expect(readdirSync(folder).some((name) => name.endsWith('.part'))).toBe(true)

      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'ready',
        'the model to be ready',
      )
      const total = Object.values(modelFiles).reduce((sum, data) => sum + data.length, 0)
      await waitFor(() => {
        const last = admin.at(-1)
        return last?.type === 'model.updated' && last.state === 'ready'
      }, 'the ready event')
      const progress = admin.filter((event) => event.type === 'model.updated')
      expect(
        progress.some(
          (event) =>
            event.state === 'downloading' &&
            event.downloadedBytes > 0 &&
            event.downloadedBytes < total,
        ),
      ).toBe(true)
      expect(progress.at(-1)).toMatchObject({
        state: 'ready',
        downloadedBytes: total,
        totalBytes: total,
      })
      for (const [name, data] of Object.entries(modelFiles)) {
        expect(readFileSync(join(folder, testModelId, name)).equals(data)).toBe(true)
      }
      await app.transcription.whenIdle()
      expect(readdirSync(folder)).toEqual([testModelId])
    })

    it('AC-21: a model archive is unpacked and only the listed files are kept', async () => {
      const staging = await mkdtemp(join(tmpdir(), 'nightjar-archive-'))
      await mkdir(join(staging, 'inner'), { recursive: true })
      for (const [name, data] of Object.entries(modelFiles)) {
        await writeFile(join(staging, 'inner', name), data)
      }
      await writeFile(join(staging, 'inner', 'extra.txt'), 'not needed')
      const archive = join(staging, 'model.tar.gz')
      expect(spawnSync('tar', ['-czf', 'model.tar.gz', 'inner'], { cwd: staging }).status).toBe(0)
      const bytes = readFileSync(archive)
      const server = createServer((_request, response) => {
        response.writeHead(200).end(bytes)
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      cleanups.push(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          }),
      )
      const files = await startModelServer()
      cleanups.push(() => files.close())
      const model = files.list.models[0]
      if (!model) throw new Error('no test model')
      const list = {
        default: model.id,
        models: [
          {
            ...model,
            downloads: [
              {
                url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}/model.tar.gz`,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                bytes: bytes.length,
                archive: true,
              },
            ],
          },
        ],
      }
      const app = await launch({ modelServer: { ...files, list } })
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'ready',
        'the unpacked model',
      )
      await app.transcription.whenIdle()
      expect(readdirSync(join(app.dataDir, 'models', testModelId)).sort()).toEqual(
        Object.keys(modelFiles).sort(),
      )
      expect(readdirSync(join(app.dataDir, 'models'))).toEqual([testModelId])
    })

    it('AC-22: files that are already there make it ready at once, without a download', async () => {
      const app = await launch()
      await app.seedModel()
      const response = await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', {
        enabled: true,
      })
      expect(response.json()).toMatchObject({ enabled: true, state: 'ready' })
      expect(app.modelServer.requests).toEqual([])
    })

    it('AC-22: a file of the wrong size is not accepted as the model', async () => {
      const app = await launch()
      await app.seedModel()
      await writeFile(join(app.dataDir, 'models', testModelId, 'test-tokens.txt'), 'short')
      const response = await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', {
        enabled: true,
      })
      expect(response.json()).toMatchObject({ state: 'downloading' })
      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'ready',
        'the model to be repaired',
      )
    })

    it('AC-23: a wrong checksum removes the partial file; recordings saved meanwhile wait and are transcribed once the model arrives', async () => {
      const app = await launch()
      app.modelServer.behaviour.corrupt = true
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'failed',
        'the download to fail',
      )
      const folder = join(app.dataDir, 'models')
      expect(readdirSync(folder).filter((name) => name.endsWith('.part'))).toEqual([])
      expect(readdirSync(join(folder, testModelId))).toEqual([])

      const waiting = await app.uploadVoice(app.alice)
      expect(waiting.status).toBe('pending')
      expect(app.fake.state.calls).toHaveLength(0)

      app.modelServer.behaviour.corrupt = false
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await doneStatus(app, waiting.id)
    })

    it('AC-23: a dropped connection counts as a failed download, and a restart starts it again', async () => {
      const modelServer = await startModelServer()
      cleanups.push(() => modelServer.close())
      const app = await launch({ modelServer })
      modelServer.behaviour.slowMs = 2
      modelServer.behaviour.dropOnce = true
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'failed',
        'the download to fail',
      )
      const before = modelServer.requests.length
      const restarted = await launchAgain(app)
      await waitFor(
        async () =>
          (await restarted.call(restarted.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'ready',
        'the restarted download',
      )
      expect(modelServer.requests.length).toBeGreaterThan(before)
    })

    it('AC-24: asks how many recordings were never transcribed and queues them one at a time on request', async () => {
      const app = await launch()
      const ids = [
        (await app.uploadVoice(app.alice)).id,
        (await app.uploadVoice(app.alice)).id,
        (await app.uploadVoice(app.alice)).id,
      ]
      expect(
        (await app.call(app.alice, 'POST', '/api/v1/admin/transcription/backlog')).statusCode,
      ).toBe(409)
      await enableTranscription(app)
      const status = await app.call(app.alice, 'GET', '/api/v1/admin/transcription')
      expect(status.json()).toMatchObject({ state: 'ready', backlogCount: 3 })

      const queued = await app.call(app.alice, 'POST', '/api/v1/admin/transcription/backlog')
      expect(queued.json()).toEqual({ queued: 3 })
      await Promise.all(ids.map((id) => doneStatus(app, id)))
      expect(app.fake.state.maxParallel).toBe(1)
      expect(
        (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json(),
      ).toMatchObject({ backlogCount: 0 })
    })

    it('AC-25: turning it off skips what is waiting, lets the running job finish and keeps the model files', async () => {
      const app = await launch()
      await enableTranscription(app)
      const release = app.fake.holdJobs()
      const running = await app.uploadVoice(app.alice)
      const waiting = [(await app.uploadVoice(app.alice)).id, (await app.uploadVoice(app.alice)).id]
      await waitFor(() => app.fake.state.parallel === 1, 'the first job to start')

      const off = await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', {
        enabled: false,
      })
      expect(off.json()).toMatchObject({ enabled: false, state: 'off' })
      expect(await app.statusOf(running.id)).toBe('transcribing')
      for (const id of waiting) expect(await app.statusOf(id)).toBe('skipped')

      release()
      await doneStatus(app, running.id)
      for (const id of waiting) expect(await app.statusOf(id)).toBe('skipped')
      expect(existsSync(join(app.dataDir, 'models', testModelId, 'test-encoder.onnx'))).toBe(true)
      const later = await app.uploadVoice(app.alice)
      expect(later.status).toBe('skipped')
      expect(app.fake.state.calls).toHaveLength(1)
    })

    it('AC-26: only an admin can use the transcription endpoints', async () => {
      const app = await launch()
      for (const [method, path] of [
        ['GET', '/api/v1/admin/transcription'],
        ['PUT', '/api/v1/admin/transcription'],
        ['POST', '/api/v1/admin/transcription/backlog'],
      ] as const) {
        const response = await app.call(
          app.bob,
          method,
          path,
          method === 'PUT' ? { enabled: true } : undefined,
        )
        expect(response.statusCode, `${method} ${path}`).toBe(403)
        expect((await app.call(null, method, path)).statusCode).toBe(401)
      }
      expect(
        (await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: 'yes' }))
          .statusCode,
      ).toBe(400)
      expect(app.modelServer.requests).toEqual([])
    })
  })

  describe('one user never reaches the data of another', () => {
    it('AC-27: another user gets 404 for audio, transcript, retry, recordings of an entry and uploads into it', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      const before = await database.db.select().from(transcripts)

      for (const [method, path, payload] of [
        ['GET', `/api/v1/recordings/${saved.id}/audio`, undefined],
        ['PATCH', `/api/v1/recordings/${saved.id}/transcript`, { text: 'hacked' }],
        ['POST', `/api/v1/recordings/${saved.id}/retry`, undefined],
        ['GET', `/api/v1/entries/${saved.entryId}/recordings`, undefined],
      ] as const) {
        const response = await app.call(app.bob, method, path, payload)
        expect(response.statusCode, `${method} ${path}`).toBe(404)
      }
      const intruder = await app.upload(app.bob, { language: 'en', entryId: saved.entryId })
      expect(intruder.statusCode).toBe(404)
      expect(await database.db.select().from(recordings)).toHaveLength(1)
      expect(await database.db.select().from(transcripts)).toEqual(before)
      expect(readdirSync(join(app.dataDir, 'media'))).toEqual([app.alice.id])
    })

    it('AC-27: the event stream of one user never gets the events of another', async () => {
      const app = await launch()
      await enableTranscription(app)
      const alice = await app.openStream(app.alice)
      const bob = await app.openStream(app.bob)
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await app.uploadVoice(app.alice)
      await waitFor(
        () =>
          alice.seen.some((event) => event.type === 'recording.updated' && event.status === 'done'),
        'alice to see her recording',
      )
      await app.uploadVoice(app.bob)
      await waitFor(
        () =>
          bob.seen.some((event) => event.type === 'recording.updated' && event.status === 'done'),
        'bob to see his recording',
      )
      const owners = (seen: LiveEvent[]) =>
        new Set(
          seen.flatMap((event) => (event.type === 'recording.updated' ? [event.entryId] : [])),
        )
      expect(owners(alice.seen).size).toBe(1)
      expect(owners(bob.seen).size).toBe(1)
      expect([...owners(alice.seen)][0]).not.toBe([...owners(bob.seen)][0])
      await waitFor(
        () => alice.seen.some((event) => event.type === 'model.updated'),
        'alice to see the model event',
      )
      expect(bob.seen.some((event) => event.type === 'model.updated')).toBe(false)
    })
  })

  describe('a server that stops, drops connections or gets long audio', () => {
    it('AC-23: a recording left in transcribing by a stopped server is picked up again on start', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      await database.db.delete(transcripts)
      await database.db.update(recordings).set({ status: 'transcribing' })

      const restarted = await launchAgain(app)
      await doneStatus(restarted, saved.id)
      expect(await database.db.select().from(transcripts)).toHaveLength(1)
    })

    it('AC-16: a recording stuck in transcribing can be retried', async () => {
      const app = await launch()
      await enableTranscription(app)
      const release = app.fake.holdJobs()
      const saved = await app.uploadVoice(app.alice)
      await waitFor(() => app.fake.state.parallel === 1, 'the job to start')
      expect(await app.statusOf(saved.id)).toBe('transcribing')
      const retried = await app.call(app.alice, 'POST', `/api/v1/recordings/${saved.id}/retry`)
      expect(retried.statusCode).toBe(200)
      release()
      await doneStatus(app, saved.id)
    })

    it('AC-16: a transcriber that failed is thrown away and the next attempt makes a new one', async () => {
      const app = await launch()
      await enableTranscription(app)
      app.fake.failNext(2)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      expect(app.fake.state.createdInstances).toBe(3)
      await waitFor(() => app.fake.state.liveInstances === 0, 'all models to be released')
    })

    it('AC-9: audio over 60 minutes is refused with 413 and leaves nothing behind', async () => {
      const app = await launch()
      const folder = mkdtempSync(join(tmpdir(), 'nightjar-long-'))
      const path = join(folder, 'long.wav')
      const made = spawnSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=8000:cl=mono',
        '-t',
        '3700',
        '-c:a',
        'pcm_u8',
        path,
      ])
      expect(made.status).toBe(0)
      const response = await app.upload(
        app.alice,
        { language: 'en', entryDate: '2026-11-26' },
        { data: readFileSync(path), name: 'long.wav' },
      )
      expect(response.statusCode).toBe(413)
      expect(response.json()).toMatchObject({ error: { code: 'recording_too_long' } })
      expect(await database.db.select().from(recordings)).toHaveLength(0)
      expect(existsSync(join(app.dataDir, 'media'))).toBe(false)
    })

    it('AC-12: closing the server while a browser holds a stream open does not hang', async () => {
      const app = await launch()
      const stream = await app.openStream(app.alice)
      expect(stream.status).toBe(200)
      const outcome = await Promise.race([
        app.app.close().then(() => 'closed'),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve('hung')
          }, 5000)
        }),
      ])
      expect(outcome).toBe('closed')
      await waitFor(() => stream.state.ended, 'the stream to end')
    })

    it('AC-12: when the connection that listens for events drops, streams end so browsers reconnect', async () => {
      const app = await launch()
      await enableTranscription(app)
      const stream = await app.openStream(app.alice)
      await database.db.execute(
        sql`select pg_terminate_backend(pid) from pg_stat_activity where query ilike 'listen nightjar_events%'`,
      )
      await waitFor(() => stream.state.ended, 'the stream to end')
      const again = await app.openStream(app.alice)
      await waitFor(async () => {
        await app.uploadVoice(app.alice)
        return again.seen.some((event) => event.type === 'recording.updated')
      }, 'events on a new stream')
    })

    it('AC-27: a user can hold at most 5 event streams open', async () => {
      const app = await launch()
      for (let index = 0; index < 5; index++) {
        expect((await app.openStream(app.alice)).status).toBe(200)
      }
      expect((await app.openStream(app.alice)).status).toBe(429)
      expect((await app.openStream(app.bob)).status).toBe(200)
    })

    it('AC-21: the download state is kept in the database, so any process can read it', async () => {
      const app = await launch()
      app.modelServer.behaviour.slowMs = 40
      await app.call(app.alice, 'PUT', '/api/v1/admin/transcription', { enabled: true })
      await waitFor(async () => {
        const [row] = await database.db.select().from(instanceSettings)
        return row?.modelDownloadState === 'downloading' && row.modelDownloadedBytes > 0
      }, 'progress in the database')
      const mid = await app.call(app.alice, 'GET', '/api/v1/admin/transcription')
      expect(mid.json<{ downloadedBytes: number }>().downloadedBytes).toBeGreaterThan(0)
      await waitFor(
        async () =>
          (await app.call(app.alice, 'GET', '/api/v1/admin/transcription')).json<{
            state: string
          }>().state === 'ready',
        'the model to be ready',
      )
      await app.transcription.whenIdle()
      await waitFor(
        async () =>
          (await database.db.select().from(instanceSettings))[0]?.modelDownloadState === 'idle',
        'idle in the database',
      )
    })
  })

  describe('measuring and logging', () => {
    it('AC-30: job duration, real-time factor and queue depth are exported without user data in their labels', async () => {
      const app = await launch({ fake: { delayMs: 50 } })
      await enableTranscription(app)
      await app.call(app.alice, 'GET', '/api/v1/me')
      const saved = await app.uploadVoice(
        app.alice,
        { language: 'hu', entryDate: '2026-11-26' },
        { data: huWav, name: `${marker}.wav` },
      )
      await doneStatus(app, saved.id)
      await waitFor(
        async () =>
          (
            await app.metrics.registry.getSingleMetricAsString('nightjar_job_duration_seconds')
          ).includes('_count{'),
        'job metrics',
      )

      const text = await app.metrics.registry.metrics()
      expect(text).toMatch(
        /nightjar_job_duration_seconds_count\{(?=[^}]*queue="transcribe")(?=[^}]*outcome="completed")[^}]*\} 1/,
      )
      expect(text).toMatch(/nightjar_transcription_rtf_count\{model="fake"\} 1/)
      expect(text).toMatch(/nightjar_queue_depth\{queue="transcribe"\} \d+/)
      const ours = text
        .split('\n')
        .filter((line) =>
          /^nightjar_(job_duration_seconds|transcription_rtf|queue_depth)/.test(line),
        )
      expect(ours.length).toBeGreaterThan(10)
      for (const line of ours) {
        const labels = /\{(.*)\}/.exec(line)?.[1] ?? ''
        expect(labels).toMatch(/^((le|queue|outcome|model)="[A-Za-z0-9.+-]+",?)+$/)
        expect(line).not.toContain(app.alice.id)
        expect(line).not.toContain(marker)
        expect(line).not.toContain(fakeTexts.hu)
      }
    })

    it('AC-31: file names, transcripts, edits and failures never reach the logs', async () => {
      const app = await launch({ fake: { text: `${marker} said the transcript` } })
      await enableTranscription(app)
      const saved = await app.uploadVoice(
        app.alice,
        { language: 'en', entryDate: '2026-11-26', note: marker },
        { data: enWav, name: `${marker}.wav` },
      )
      await doneStatus(app, saved.id)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: `${marker} edited`,
      })
      await app.upload(
        app.alice,
        { language: 'en', entryDate: '2026-11-26' },
        { data: Buffer.from(marker.repeat(50)), name: `${marker}.m4a` },
      )
      await app.call(app.alice, 'GET', `/api/v1/entries/${saved.entryId}/recordings`)
      app.fake.failNext(3)
      const failing = await app.uploadVoice(
        app.alice,
        { language: 'en', entryDate: '2026-11-26' },
        { data: enWav, name: `${marker}.wav` },
      )
      await waitFor(async () => (await app.statusOf(failing.id)) === 'failed', 'the failing job')
      expectNoMarkersInLogs(app.capture, [marker, 'said the transcript'])
      const lines = app.capture.lines()
      expect(
        lines.some(
          (line) => typeof line['jobId'] === 'string' && typeof line['requestId'] === 'string',
        ),
      ).toBe(true)
      expect(lines.some((line) => line['msg'] === 'transcription failed')).toBe(true)
    })

    it('AC-11: job log lines carry the job id and the id of the request that queued it', async () => {
      const app = await launch()
      await enableTranscription(app)
      const saved = await app.uploadVoice(app.alice)
      await doneStatus(app, saved.id)
      await waitFor(
        () => app.capture.lines().some((line) => line['msg'] === 'transcription job finished'),
        'the finished line',
      )
      const started = app.capture
        .lines()
        .find((line) => line['msg'] === 'transcription job started')
      expect(started).toMatchObject({
        jobId: expect.any(String) as string,
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      })
    })
  })
})
