import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { LiveEvent, TranscriptionStatus } from '@nightjar/shared/recordings'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { entries, instanceSettings, recordings, transcripts, users } from '../src/db/schema.ts'
import { createEvents } from '../src/events.ts'
import { createJobs } from '../src/jobs.ts'
import { createLogger } from '../src/logger.ts'
import { fakeTexts } from '../src/modules/transcription/fake-transcriber.ts'
import { createTranscriptionService } from '../src/modules/transcription/service.ts'
import { createStorage } from '../src/storage.ts'
import { expectNoMarkersInLogs } from './support/log-capture.ts'
import {
  largeModelId,
  modelFilesOf,
  startModelServer,
  testModelId,
} from './support/model-server.ts'
import { startPostgres } from './support/postgres.ts'
import {
  createVoiceHarness,
  enWav,
  resetInstanceSettings,
  waitFor,
} from './support/voice-harness.ts'

const marker = 'ZQX-PRIVATE-7781'
const adminPath = '/api/v1/admin/transcription'

describe('009-transcription-models: model choice and transcribe again against a real Postgres', () => {
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
    await resetInstanceSettings(database)
    await database.db.execute(sql`drop schema if exists pgboss cascade`)
  })

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  const { launch, launchAgain } = createVoiceHarness({
    postgres: () => postgres,
    database: () => database,
    cleanups,
  })
  type App = Awaited<ReturnType<typeof launch>>

  /** Read from the service, so polling does not run into the rate limit of the API. */
  const statusOf = (app: App): Promise<TranscriptionStatus> => app.transcription.status()

  const rowOf = (status: TranscriptionStatus, id: string) => {
    const row = status.models.find((model) => model.id === id)
    if (!row) throw new Error(`no row for ${id}`)
    return row
  }

  const waitForModel = (app: App, id: string, state: string) =>
    waitFor(async () => rowOf(await statusOf(app), id).state === state, `${id} to be ${state}`)

  /** Transcription on with turbo on disk. */
  async function turnOn(app: App) {
    await app.seedModel()
    await app.call(app.alice, 'PUT', adminPath, { enabled: true })
    await waitFor(async () => (await statusOf(app)).state === 'ready', 'a ready model')
  }

  const modelOfTranscript = async (recordingId: string) =>
    (
      await database.db
        .select({ model: transcripts.model })
        .from(transcripts)
        .where(eq(transcripts.recordingId, recordingId))
    )[0]?.model

  const done = (app: App, id: string) =>
    waitFor(async () => (await app.statusOf(id)) === 'done', 'a done recording')

  const filesOnDisk = (app: App, id: string) => {
    const folder = join(app.dataDir, 'models', id)
    return existsSync(folder) ? readdirSync(folder).sort() : []
  }

  const requestsFor = (app: App, id: string) =>
    app.modelServer.requests.filter((request) => request.startsWith(`${id}/`))

  describe('the model list', () => {
    it('AC-2: the status lists both models in order with the active one and their sizes', async () => {
      const app = await launch()
      const response = await app.call(app.alice, 'GET', adminPath)
      expect(response.statusCode).toBe(200)
      const status = response.json<TranscriptionStatus>()
      expect(status.activeModel).toBe(testModelId)
      expect(status.models.map((model) => model.id)).toEqual([testModelId, largeModelId])
      expect(status.models.map((model) => model.state)).toEqual([
        'not_downloaded',
        'not_downloaded',
      ])
      const turbo = rowOf(status, testModelId)
      expect(turbo.downloadBytes).toBe(
        Object.values(modelFilesOf[testModelId] ?? {}).reduce((sum, data) => sum + data.length, 0),
      )
      expect(turbo.diskBytes).toBe(turbo.downloadBytes)
    })

    it('AC-3: a download fills the model folder with progress and does not change the active model', async () => {
      const app = await launch()
      await turnOn(app)
      app.modelServer.behaviour.slowMs = 20
      const admin = app.hubEvents(app.alice.id, true)
      const started = await app.call(
        app.alice,
        'POST',
        `${adminPath}/models/${largeModelId}/download`,
      )
      expect(started.statusCode).toBe(200)
      await waitForModel(app, largeModelId, 'downloading')

      const waiting = await app.uploadVoice(app.alice)
      await done(app, waiting.id)
      expect(await modelOfTranscript(waiting.id)).toBe(testModelId)

      await waitForModel(app, largeModelId, 'downloaded')
      expect(filesOnDisk(app, largeModelId)).toEqual(
        Object.keys(modelFilesOf[largeModelId] ?? {}).sort(),
      )
      expect((await statusOf(app)).activeModel).toBe(testModelId)
      const progress = admin.filter(
        (event) =>
          event.type === 'model.updated' &&
          event.models.some((row) => row.id === largeModelId && row.state === 'downloading'),
      )
      expect(progress.length).toBeGreaterThan(0)
    })

    it('AC-4: use on a model that is not downloaded downloads it, then makes it active and keeps the old files', async () => {
      const app = await launch()
      await turnOn(app)
      app.modelServer.behaviour.slowMs = 20
      const response = await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      expect(response.statusCode).toBe(200)
      expect(rowOf(response.json<TranscriptionStatus>(), largeModelId)).toMatchObject({
        state: 'downloading',
        useWhenReady: true,
      })
      await waitFor(async () => (await statusOf(app)).activeModel === largeModelId, 'the switch')
      const status = await statusOf(app)
      expect(rowOf(status, largeModelId).state).toBe('downloaded')
      expect(rowOf(status, testModelId).state).toBe('downloaded')
      expect(filesOnDisk(app, testModelId)).toHaveLength(4)
    })

    it('AC-4: use while the same model downloads marks it as then-use', async () => {
      const app = await launch()
      await turnOn(app)
      app.modelServer.behaviour.slowMs = 20
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/download`)
      const marked = await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      expect(rowOf(marked.json<TranscriptionStatus>(), largeModelId).useWhenReady).toBe(true)
      await waitFor(async () => (await statusOf(app)).activeModel === largeModelId, 'the switch')
    })

    it('AC-5: use on a downloaded model switches at once without any download', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      const response = await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      expect(response.json<TranscriptionStatus>().activeModel).toBe(largeModelId)
      expect(app.modelServer.requests).toEqual([])
      expect(filesOnDisk(app, testModelId)).toHaveLength(4)
    })

    it('AC-6: while a model downloads, another one cannot start a download or a switch', async () => {
      const app = await launch()
      app.modelServer.behaviour.slowMs = 20
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitForModel(app, testModelId, 'downloading')
      for (const action of ['download', 'use']) {
        const response = await app.call(
          app.alice,
          'POST',
          `${adminPath}/models/${largeModelId}/${action}`,
        )
        expect(response.statusCode).toBe(409)
        expect(response.json()).toMatchObject({ error: { code: 'download_running' } })
      }
      await waitForModel(app, testModelId, 'downloaded')
    })

    it('AC-7: delete removes the folder, and the active or downloading model cannot be deleted', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      const removed = await app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`)
      expect(removed.statusCode).toBe(200)
      expect(rowOf(removed.json<TranscriptionStatus>(), largeModelId).state).toBe('not_downloaded')
      expect(existsSync(join(app.dataDir, 'models', largeModelId))).toBe(false)

      const active = await app.call(app.alice, 'DELETE', `${adminPath}/models/${testModelId}`)
      expect(active.statusCode).toBe(409)
      expect(active.json()).toMatchObject({ error: { code: 'model_in_use' } })

      app.modelServer.behaviour.slowMs = 20
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/download`)
      const downloading = await app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`)
      expect(downloading.statusCode).toBe(409)
      expect(downloading.json()).toMatchObject({ error: { code: 'model_downloading' } })
      await waitForModel(app, largeModelId, 'downloaded')

      const again = await app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`)
      expect(again.statusCode).toBe(200)
      expect(
        (await app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`)).statusCode,
      ).toBe(200)
    })

    it('AC-8: a model that was deleted is downloaded again in full', async () => {
      const app = await launch()
      await turnOn(app)
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/download`)
      await waitForModel(app, largeModelId, 'downloaded')
      expect(requestsFor(app, largeModelId)).toHaveLength(4)
      await app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`)
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/download`)
      await waitForModel(app, largeModelId, 'downloaded')
      expect(requestsFor(app, largeModelId)).toHaveLength(8)
    })

    it('AC-9: a wrong checksum or a dropped connection leaves nothing behind, and retry repeats then-use', async () => {
      const app = await launch()
      await turnOn(app)
      app.modelServer.behaviour.corrupt = true
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitForModel(app, largeModelId, 'failed')
      const failed = rowOf(await statusOf(app), largeModelId)
      expect(failed).toMatchObject({ error: 'download_failed', useWhenReady: true })
      expect(readdirSync(join(app.dataDir, 'models')).sort()).toEqual([testModelId])
      expect((await statusOf(app)).activeModel).toBe(testModelId)

      app.modelServer.behaviour.corrupt = false
      app.modelServer.behaviour.dropOnce = true
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitForModel(app, largeModelId, 'failed')
      expect(readdirSync(join(app.dataDir, 'models')).sort()).toEqual([testModelId])

      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitFor(async () => (await statusOf(app)).activeModel === largeModelId, 'the switch')
    })

    it('AC-11: leftovers are removed on start, the active download resumes, another model shows as failed', async () => {
      const modelServer = await startModelServer()
      cleanups.push(() => modelServer.close())
      const app = await launch({ modelServer })
      const events = app.hubEvents(app.alice.id, true)
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitFor(
        () => events.some((event) => event.type === 'model.updated' && event.state === 'ready'),
        'the ready event',
      )
      await waitFor(async () => {
        const [saved] = await database.db.select().from(instanceSettings)
        return saved?.modelDownloadId === null && saved.modelDownloadState === 'idle'
      }, 'the download slot to be cleared')
      await database.db.update(instanceSettings).set({
        modelDownloadState: 'downloading',
        modelDownloadId: largeModelId,
        modelDownloadUse: true,
        modelDownloadedBytes: 1000,
      })
      const models = join(app.dataDir, 'models')
      writeFileSync(join(models, `${largeModelId}.0.part`), 'half')
      mkdirSync(join(models, largeModelId))
      writeFileSync(join(models, largeModelId, 'large-encoder.onnx'), 'verified but incomplete')
      mkdirSync(join(models, `${largeModelId}.unpacked`))
      writeFileSync(join(models, `${largeModelId}.unpacked`, 'x'), 'half')

      const second = await launchAgain(app)
      await waitFor(
        async () => rowOf(await statusOf(second), largeModelId).state === 'failed',
        'failed',
      )
      expect(readdirSync(models).sort()).toEqual([testModelId])
      expect(rowOf(await statusOf(second), largeModelId)).toMatchObject({
        error: 'download_failed',
        useWhenReady: true,
      })
      expect(requestsFor(second, largeModelId)).toEqual([])

      await rm(join(models, testModelId), { recursive: true })
      await database.db.update(instanceSettings).set({
        modelDownloadState: 'downloading',
        modelDownloadId: testModelId,
        modelDownloadUse: false,
        modelDownloadError: null,
      })
      const third = await launchAgain(second)
      await waitFor(async () => (await statusOf(third)).state === 'ready', 'the active model again')
      expect(filesOnDisk(third, testModelId)).toHaveLength(4)
    })

    it('AC-3: byte counts above 2 GB are stored and read back', async () => {
      const app = await launch()
      await database.db.update(instanceSettings).set({
        transcriptionEnabled: true,
        modelDownloadState: 'downloading',
        modelDownloadId: largeModelId,
        modelDownloadedBytes: 3_238_731_176,
      })
      expect(rowOf(await statusOf(app), largeModelId).downloadedBytes).toBe(3_238_731_176)
    })

    it('AC-6: download and use answer 409 while transcription is off', async () => {
      const app = await launch()
      for (const action of ['download', 'use']) {
        const response = await app.call(
          app.alice,
          'POST',
          `${adminPath}/models/${largeModelId}/${action}`,
        )
        expect(response.statusCode).toBe(409)
        expect(response.json()).toMatchObject({ error: { code: 'model_not_ready' } })
      }
    })

    it('AC-5: Use and Delete of the same model at once never leave an active model without files', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      await Promise.all([
        app.call(app.alice, 'DELETE', `${adminPath}/models/${largeModelId}`),
        app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`),
      ])
      await app.transcription.whenIdle()
      await waitFor(
        async () => (await statusOf(app)).models.every((row) => row.state !== 'downloading'),
        'no download',
      )
      const status = await statusOf(app)
      expect(rowOf(status, status.activeModel).state).toBe('downloaded')
    })

    it('AC-5: switching at once cancels the then-use of a running download', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      app.modelServer.behaviour.slowMs = 20
      await app.call(app.alice, 'DELETE', `${adminPath}/models/${testModelId}`)
      await app.call(app.alice, 'POST', `${adminPath}/models/${testModelId}/use`)
      expect(rowOf(await statusOf(app), testModelId)).toMatchObject({
        state: 'downloading',
        useWhenReady: true,
      })
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitForModel(app, testModelId, 'downloaded')
      expect((await statusOf(app)).activeModel).toBe(largeModelId)
    })

    it('AC-9: a finished download of another model does not queue jobs while the active model is missing', async () => {
      const app = await launch()
      app.modelServer.behaviour.corrupt = true
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitForModel(app, testModelId, 'failed')
      const waiting = await app.uploadVoice(app.alice)
      app.modelServer.behaviour.corrupt = false
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/download`)
      await waitForModel(app, largeModelId, 'downloaded')
      await app.transcription.whenIdle()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(app.fake.state.calls).toHaveLength(0)
      expect(await app.statusOf(waiting.id)).toBe('pending')
    })

    it('AC-12: turning transcription off stops a running download and removes its files', async () => {
      const app = await launch()
      app.modelServer.behaviour.slowMs = 20
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitForModel(app, testModelId, 'downloading')
      await new Promise((resolve) => setTimeout(resolve, 150))
      await app.call(app.alice, 'PUT', adminPath, { enabled: false })
      await app.transcription.whenIdle()
      const status = await statusOf(app)
      expect(rowOf(status, testModelId).state).toBe('not_downloaded')
      expect(readdirSync(join(app.dataDir, 'models'))).toEqual([])
    })

    it('AC-13: model.updated carries the active model and every row, on progress, switch and delete', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      const admin = app.hubEvents(app.alice.id, true)
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitFor(
        () =>
          admin.some(
            (event) => event.type === 'model.updated' && event.activeModel === largeModelId,
          ),
        'the switch event',
      )
      await app.call(app.alice, 'DELETE', `${adminPath}/models/${testModelId}`)
      await waitFor(
        () =>
          admin.some(
            (event) =>
              event.type === 'model.updated' &&
              event.models.find((row) => row.id === testModelId)?.state === 'not_downloaded',
          ),
        'the delete event',
      )
      const last = admin
        .filter(
          (event): event is Extract<LiveEvent, { type: 'model.updated' }> =>
            event.type === 'model.updated',
        )
        .at(-1)
      expect(last?.models.map((row) => row.id)).toEqual([testModelId, largeModelId])
    })
  })

  describe('which model runs', () => {
    it('AC-14: a switch never interrupts a running job, and only one model is loaded at a time', async () => {
      const app = await launch({ fake: { textNamesModel: true } })
      await turnOn(app)
      await app.seedModel(largeModelId)
      const release = app.fake.holdJobs()
      const first = await app.uploadVoice(app.alice)
      const second = await app.uploadVoice(app.alice)
      await waitFor(() => app.fake.state.calls.length === 1, 'the first job to run')
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      release()
      await done(app, first.id)
      await done(app, second.id)
      expect(await modelOfTranscript(first.id)).toBe(testModelId)
      expect(await modelOfTranscript(second.id)).toBe(largeModelId)
      expect(app.fake.state.createdFor).toEqual({ [testModelId]: 1, [largeModelId]: 1 })
      expect(app.fake.state.maxLiveInstances).toBe(1)
    })

    it('AC-15: a model whose files are gone at load time fails that attempt and the retry uses the active model', async () => {
      let first = true
      const holder: { app?: App } = {}
      const app = await launch({
        wrapFactory: (factory) => (model) => {
          const folder = join(holder.app?.dataDir ?? '', 'models', model.id)
          if (first) {
            first = false
            void rm(folder, { recursive: true, force: true })
            void holder.app?.call(
              holder.app.alice,
              'POST',
              `${adminPath}/models/${largeModelId}/use`,
            )
            throw new Error('the model files are gone')
          }
          return factory(model)
        },
      })
      holder.app = app
      await turnOn(app)
      await app.seedModel(largeModelId)
      const saved = await app.uploadVoice(app.alice)
      await done(app, saved.id)
      expect(await modelOfTranscript(saved.id)).toBe(largeModelId)
    })

    it('AC-16: deleting the model of a running job succeeds and the job still finishes with it', async () => {
      const app = await launch()
      await turnOn(app)
      await app.seedModel(largeModelId)
      const release = app.fake.holdJobs()
      const saved = await app.uploadVoice(app.alice)
      await waitFor(() => app.fake.state.calls.length === 1, 'the job to run')
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      const removed = await app.call(app.alice, 'DELETE', `${adminPath}/models/${testModelId}`)
      expect(removed.statusCode).toBe(200)
      release()
      await done(app, saved.id)
      expect(await modelOfTranscript(saved.id)).toBe(testModelId)
    })
  })

  describe('transcribe again', () => {
    const retranscribe = (app: App, id: string, payload?: object) =>
      app.call(app.alice, 'POST', `/api/v1/recordings/${id}/retranscribe`, payload)

    const transcriptOf = async (id: string) =>
      (await database.db.select().from(transcripts).where(eq(transcripts.recordingId, id)))[0]

    async function withTranscript(app: App) {
      await turnOn(app)
      const saved = await app.uploadVoice(app.alice)
      await done(app, saved.id)
      return saved
    }

    it('AC-18: the recording goes pending, transcribing, done with the active model and search follows', async () => {
      const app = await launch({ fake: { textNamesModel: true } })
      const saved = await withTranscript(app)
      await app.seedModel(largeModelId)
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      const seen = app.hubEvents(app.alice.id)
      expect(
        (await app.call(app.alice, 'POST', '/api/v1/search', { q: 'turbo' })).json(),
      ).toMatchObject({ total: 1 })

      const response = await retranscribe(app, saved.id)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        status: 'pending',
        transcript: { model: testModelId },
      })
      await done(app, saved.id)
      expect(
        seen.filter((event) => event.type === 'recording.updated').map((event) => event.status),
      ).toEqual(['pending', 'transcribing', 'done'])
      const transcript = await transcriptOf(saved.id)
      expect(transcript).toMatchObject({ model: largeModelId, isUserEdited: false })
      expect(transcript?.text).toContain(fakeTexts.en)
      expect(
        (await app.call(app.alice, 'POST', '/api/v1/search', { q: 'turbo' })).json(),
      ).toMatchObject({ total: 0 })
      expect(
        (await app.call(app.alice, 'POST', '/api/v1/search', { q: 'large-v3-int8' })).json(),
      ).toMatchObject({ total: 1 })
    })

    it('AC-19: an edited transcript needs replaceEdited, which replaces the edit', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: 'my own words',
      })
      const calls = app.fake.state.calls.length

      const refused = await retranscribe(app, saved.id)
      expect(refused.statusCode).toBe(409)
      expect(refused.json()).toMatchObject({ error: { code: 'transcript_edited' } })
      expect((await retranscribe(app, saved.id, { replaceEdited: false })).statusCode).toBe(409)
      expect((await retranscribe(app, saved.id, { replaceEdited: 'yes' })).statusCode).toBe(400)
      expect((await retranscribe(app, saved.id, { other: true })).statusCode).toBe(400)
      expect(await app.statusOf(saved.id)).toBe('done')
      expect(app.fake.state.calls).toHaveLength(calls)

      const replaced = await retranscribe(app, saved.id, { replaceEdited: true })
      expect(replaced.statusCode).toBe(200)
      await waitFor(() => app.fake.state.calls.length === calls + 1, 'the new job')
      await done(app, saved.id)
      expect(await transcriptOf(saved.id)).toMatchObject({
        text: fakeTexts.en,
        isUserEdited: false,
      })
    })

    it('AC-19: a confirmed replace survives a server restart that queues the recording again', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: 'my own words',
      })
      await database.db
        .update(recordings)
        .set({ status: 'pending', replaceEdited: true })
        .where(eq(recordings.id, saved.id))

      const restarted = await launchAgain(app)
      await done(restarted, saved.id)
      expect(await transcriptOf(saved.id)).toMatchObject({
        text: fakeTexts.en,
        isUserEdited: false,
      })
      const [row] = await database.db.select().from(recordings).where(eq(recordings.id, saved.id))
      expect(row?.replaceEdited).toBe(false)
    })

    it('AC-19: the confirmed replace is dropped when the recording is skipped or the user edits again', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      await database.db
        .update(recordings)
        .set({ status: 'pending', replaceEdited: true })
        .where(eq(recordings.id, saved.id))
      await app.call(app.alice, 'PUT', adminPath, { enabled: false })
      const [skipped] = await database.db
        .select()
        .from(recordings)
        .where(eq(recordings.id, saved.id))
      expect(skipped).toMatchObject({ status: 'skipped', replaceEdited: false })

      await database.db
        .update(recordings)
        .set({ replaceEdited: true })
        .where(eq(recordings.id, saved.id))
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: 'mine',
      })
      const [edited] = await database.db
        .select()
        .from(recordings)
        .where(eq(recordings.id, saved.id))
      expect(edited?.replaceEdited).toBe(false)
    })

    it('AC-20: it is refused while transcription is off, the model is missing or the recording is busy', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      const release = app.fake.holdJobs()
      expect((await retranscribe(app, saved.id)).statusCode).toBe(200)
      await waitFor(() => app.fake.state.calls.length === 2, 'the job to run')
      const busy = await retranscribe(app, saved.id)
      expect(busy.statusCode).toBe(409)
      expect(busy.json()).toMatchObject({ error: { code: 'already_transcribing' } })
      release()
      await done(app, saved.id)

      await rm(join(app.dataDir, 'models', testModelId), { recursive: true })
      const noModel = await retranscribe(app, saved.id)
      expect(noModel.statusCode).toBe(409)
      expect(noModel.json()).toMatchObject({ error: { code: 'model_not_ready' } })
      expect((await app.call(app.alice, 'GET', '/api/v1/transcription')).json()).toEqual({
        state: 'not_ready',
      })

      await app.call(app.alice, 'PUT', adminPath, { enabled: false })
      expect((await retranscribe(app, saved.id)).json()).toMatchObject({
        error: { code: 'model_not_ready' },
      })
      expect((await app.call(app.alice, 'GET', '/api/v1/transcription')).json()).toEqual({
        state: 'off',
      })
    })

    it('AC-21: a job that fails for good leaves the old transcript as it was', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: 'my own words',
      })
      const before = await transcriptOf(saved.id)
      app.fake.failNext(3)
      await retranscribe(app, saved.id, { replaceEdited: true })
      await waitFor(async () => (await app.statusOf(saved.id)) === 'failed', 'the job to fail')
      expect(await transcriptOf(saved.id)).toEqual(before)
      const listed = await app.call(app.alice, 'GET', `/api/v1/entries/${saved.entryId}/recordings`)
      expect(listed.json()).toMatchObject([
        { status: 'failed', transcript: { text: 'my own words', isUserEdited: true } },
      ])

      const again = await retranscribe(app, saved.id, { replaceEdited: true })
      expect(again.statusCode).toBe(200)
      await done(app, saved.id)
      expect((await transcriptOf(saved.id))?.text).toBe(fakeTexts.en)
    })

    it('AC-22: another user gets 404 and nothing is queued, and any signed-in user can ask if transcription is available', async () => {
      const app = await launch()
      const saved = await withTranscript(app)
      const calls = app.fake.state.calls.length
      const response = await app.call(
        app.bob,
        'POST',
        `/api/v1/recordings/${saved.id}/retranscribe`,
        {},
      )
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'recording_not_found' } })
      expect(
        (await app.call(app.bob, 'POST', '/api/v1/recordings/not-an-id/retranscribe')).statusCode,
      ).toBe(404)
      expect(await app.statusOf(saved.id)).toBe('done')
      expect(app.fake.state.calls).toHaveLength(calls)

      const availability = await app.call(app.bob, 'GET', '/api/v1/transcription')
      expect(availability.statusCode).toBe(200)
      expect(availability.json()).toEqual({ state: 'ready' })
      expect((await app.call(null, 'GET', '/api/v1/transcription')).statusCode).toBe(401)
      expect(
        (await app.call(null, 'POST', `/api/v1/recordings/${saved.id}/retranscribe`)).statusCode,
      ).toBe(401)
    })
  })

  describe('access', () => {
    it('AC-25: only an admin reaches the model routes, and an unknown id is a 404', async () => {
      const app = await launch()
      await turnOn(app)
      const routes: [string, string][] = [
        ['POST', `${adminPath}/models/${largeModelId}/download`],
        ['POST', `${adminPath}/models/${largeModelId}/use`],
        ['DELETE', `${adminPath}/models/${largeModelId}`],
      ]
      for (const [method, path] of routes) {
        expect((await app.call(app.bob, method as 'POST' | 'DELETE', path)).statusCode).toBe(403)
        expect((await app.call(null, method as 'POST' | 'DELETE', path)).statusCode).toBe(401)
      }
      for (const [method, path] of [
        ['POST', `${adminPath}/models/nope/download`],
        ['POST', `${adminPath}/models/nope/use`],
        ['DELETE', `${adminPath}/models/nope`],
      ] as const) {
        const response = await app.call(app.alice, method, path)
        expect(response.statusCode).toBe(404)
        expect(response.json()).toMatchObject({ error: { code: 'unknown_model' } })
      }
      expect((await app.call(app.bob, 'GET', adminPath)).statusCode).toBe(403)
    })

    it('AC-27: text, edits and file names stay out of the logs, and model lines carry only the id', async () => {
      const app = await launch({ fake: { text: `private ${marker}` } })
      await turnOn(app)
      const saved = await app.uploadVoice(app.alice, undefined, {
        data: enWav,
        name: `${marker}.wav`,
      })
      await done(app, saved.id)
      await app.call(app.alice, 'PATCH', `/api/v1/recordings/${saved.id}/transcript`, {
        text: `edit ${marker}`,
      })
      await app.call(app.alice, 'POST', `${adminPath}/models/${largeModelId}/use`)
      await waitFor(async () => (await statusOf(app)).activeModel === largeModelId, 'the switch')
      await app.call(app.alice, 'POST', `/api/v1/recordings/${saved.id}/retranscribe`, {
        replaceEdited: true,
      })
      await done(app, saved.id)
      app.fake.failNext(3)
      await app.call(app.alice, 'POST', `/api/v1/recordings/${saved.id}/retranscribe`, {})
      await waitFor(async () => (await app.statusOf(saved.id)) === 'failed', 'the job to fail')
      await app.call(app.alice, 'DELETE', `${adminPath}/models/${testModelId}`)

      expectNoMarkersInLogs(app.capture, [marker])
      const modelLines = app.capture
        .lines()
        .filter((line) =>
          ['model switched', 'model deleted', 'model download started'].includes(String(line.msg)),
        )
      expect(modelLines.length).toBeGreaterThanOrEqual(3)
      for (const line of modelLines) {
        expect(
          Object.keys(line).filter(
            (key) => !['level', 'time', 'pid', 'hostname', 'msg', 'modelId'].includes(key),
          ),
        ).toEqual([])
      }
    })
  })

  describe('upgrading a 0.2.0 install', () => {
    it('AC-24: a database at migration 0007 gets turbo as the active, downloaded model and nothing is downloaded', async () => {
      const name = `upgrade_${String(Date.now())}`
      await database.db.execute(sql.raw(`create database ${name}`))
      const base = new URL(postgres.getConnectionUri())
      base.pathname = `/${name}`
      const old = createDatabase(base.toString(), createLogger({ level: 'silent' }))
      cleanups.push(() =>
        database.db.execute(sql.raw(`drop database ${name}`)).then(() => undefined),
      )
      cleanups.push(() => old.close())

      const real = join(import.meta.dirname, '../migrations')
      const folder = mkdtempSync(join(tmpdir(), 'nightjar-0007-'))
      cpSync(real, folder, { recursive: true })
      const journalPath = join(folder, 'meta', '_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number }[]
      }
      journal.entries = journal.entries.filter((entry) => entry.idx <= 7)
      writeFileSync(journalPath, JSON.stringify(journal))
      await old.migrate(folder)
      expect(
        (
          await old.db.execute(
            sql`select column_name from information_schema.columns where table_name = 'instance_settings' and column_name = 'active_model'`,
          )
        ).rows,
      ).toEqual([])

      await old.db.execute(sql`
        insert into instance_settings (id, transcription_enabled, auth_secret, model_download_state)
        values (1, true, 'secret', 'failed')`)
      const [user] = await old.db
        .insert(users)
        .values({ name: 'a', username: 'old', timeZone: 'UTC' })
        .returning()
      const [entry] = await old.db
        .insert(entries)
        .values({ userId: user?.id ?? '', entryDate: '2026-11-01' })
        .returning()
      const recordingRows = await old.db.execute<{ id: string }>(sql`
        insert into recordings (user_id, entry_id, file_path, mime_type, size_bytes, duration_ms, language, status)
        values (${user?.id ?? ''}, ${entry?.id ?? ''}, 'media/x/recordings/x.wav', 'audio/wav', 1, 1, 'hu', 'done')
        returning id`)
      const recording = recordingRows.rows[0]
      await old.db.insert(transcripts).values({
        userId: user?.id ?? '',
        recordingId: recording?.id ?? '',
        model: testModelId,
        language: 'hu',
        text: 'régi átirat',
      })

      await old.migrate(real)
      expect(
        (
          await old.db.execute(
            sql`select model_download_id, model_download_error, active_model from instance_settings`,
          )
        ).rows,
      ).toEqual([
        {
          model_download_id: testModelId,
          model_download_error: 'download_failed',
          active_model: testModelId,
        },
      ])
      const dataDir = mkdtempSync(join(tmpdir(), 'nightjar-data-'))
      const files = modelFilesOf[testModelId] ?? {}
      mkdirSync(join(dataDir, 'models', testModelId), { recursive: true })
      for (const [file, data] of Object.entries(files)) {
        writeFileSync(join(dataDir, 'models', testModelId, file), data)
      }
      const modelServer = await startModelServer()
      cleanups.push(() => modelServer.close())
      const logger = createLogger({ level: 'silent' })
      const service = createTranscriptionService({
        database: old,
        storage: createStorage(dataDir),
        jobs: createJobs(base.toString(), logger),
        events: createEvents({ databaseUrl: base.toString(), database: old, logger }),
        logger,
        models: modelServer.list,
      })
      await service.resume()
      const status = await service.status()
      expect(status).toMatchObject({ enabled: true, state: 'ready', activeModel: testModelId })
      expect(status.models.map((model) => [model.id, model.state])).toEqual([
        [testModelId, 'downloaded'],
        [largeModelId, 'not_downloaded'],
      ])
      expect(modelServer.requests).toEqual([])
      const [kept] = await old.db.select({ model: transcripts.model }).from(transcripts)
      expect(kept?.model).toBe(testModelId)
    })
  })
})
