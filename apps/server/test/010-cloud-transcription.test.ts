import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { LiveEvent, TranscriptionStatus } from '@nightjar/shared/recordings'
import { eq, sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import {
  cloudCopies,
  entries,
  providerSecrets,
  recordings,
  transcripts,
  users,
} from '../src/db/schema.ts'
import { createEvents } from '../src/events.ts'
import { createJobs } from '../src/jobs.ts'
import { createLogger } from '../src/logger.ts'
import { createSonioxProvider } from '../src/modules/transcription/cloud/soniox.ts'
import { createKeyStore } from '../src/modules/transcription/cloud/key-store.ts'
import {
  createSecretBox,
  resolveInstanceSecret,
} from '../src/modules/transcription/cloud/secrets.ts'
import { createTranscriptionService } from '../src/modules/transcription/service.ts'
import { createStorage } from '../src/storage.ts'
import { pausesOgg, probe, sampleAs } from './support/audio.ts'
import { startCloudServer, type CloudServer } from './support/cloud-server.ts'
import { captureLogs } from './support/log-capture.ts'
import { startModelServer, testModelId } from './support/model-server.ts'
import { startPostgres } from './support/postgres.ts'
import { createVoiceHarness, resetInstanceSettings, waitFor } from './support/voice-harness.ts'

const adminPath = '/api/v1/admin/transcription'
const providerPath = (id: string) => `${adminPath}/providers/${id}`
const savedKey = 'sk-saved-key-4412'

describe('010-cloud-transcription: cloud providers against a real Postgres', () => {
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

  const statusOf = (app: App): Promise<TranscriptionStatus> => app.transcription.status()

  const putKey = (app: App, id: string, apiKey: string = savedKey) =>
    app.call(app.alice, 'PUT', `${providerPath(id)}/secrets`, { apiKey })

  const useProvider = (app: App, id: string) =>
    app.call(app.alice, 'POST', `${providerPath(id)}/use`)

  /** Transcription on with turbo on disk, then a key saved and the provider switched to. */
  async function turnOnCloud(app: App, id = 'soniox') {
    await app.seedModel()
    await app.call(app.alice, 'PUT', adminPath, { enabled: true })
    await waitFor(async () => (await statusOf(app)).state === 'ready', 'a ready model')
    expect((await putKey(app, id)).statusCode).toBe(200)
    expect((await useProvider(app, id)).statusCode).toBe(200)
  }

  const recordingRow = async (id: string) =>
    (await database.db.select().from(recordings).where(eq(recordings.id, id)))[0]

  const transcriptOf = async (recordingId: string) =>
    (
      await database.db.select().from(transcripts).where(eq(transcripts.recordingId, recordingId))
    )[0]

  const waitForStatus = (app: App, id: string, status: string) =>
    waitFor(async () => (await app.statusOf(id)) === status, `a ${status} recording`)

  const copyRows = () => database.db.select().from(cloudCopies)

  const upload = (app: App, data: Buffer, language = 'hu', name = 'memo.webm') =>
    app.uploadVoice(app.alice, { language, entryDate: '2026-11-26' }, { data, name })

  const decryptedKey = async (app: App, id: string) => {
    const secret = await resolveInstanceSecret({
      env: undefined,
      dataDir: app.dataDir,
      logger: createLogger({ level: 'silent' }),
    })
    const [row] = await database.db
      .select()
      .from(providerSecrets)
      .where(eq(providerSecrets.providerId, id))
    return { row, plain: row ? createSecretBox(secret).decrypt(id, row.ciphertext) : undefined }
  }

  describe('engines and keys', () => {
    it('AC-2: the status lists the engines, the providers in registry order and a usage entry each', async () => {
      const app = await launch()
      const status = (await app.call(app.alice, 'GET', adminPath)).json<TranscriptionStatus>()
      expect(status.activeEngine).toBe(testModelId)
      expect(
        status.providers.map((provider) => [provider.id, provider.label, provider.configured]),
      ).toEqual([
        ['soniox', 'Soniox', false],
        ['gladia', 'Gladia', false],
      ])
      expect(status.providers[1]?.pricePerHour).toEqual({ amount: 0.27, currency: 'EUR' })
      expect(status.usage).toEqual([
        { engine: 'soniox', audioMs: 0, estimatedCost: 0 },
        { engine: 'gladia', audioMs: 0, estimatedCost: 0 },
      ])
    })

    it('AC-3: a provider without a key cannot be switched to', async () => {
      const app = await launch()
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      const response = await useProvider(app, 'soniox')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'api_key_missing' } })
      expect((await statusOf(app)).activeEngine).toBe(testModelId)
    })

    it('AC-4: the key is stored encrypted and never comes back in a response, status or event', async () => {
      const app = await launch()
      const events = app.hubEvents(app.alice.id, true)
      const response = await putKey(app, 'soniox')
      expect(response.statusCode).toBe(200)
      const { row, plain } = await decryptedKey(app, 'soniox')
      expect(row?.ciphertext.startsWith('v1.')).toBe(true)
      expect(row?.ciphertext).not.toContain(savedKey)
      expect(plain).toEqual({ apiKey: savedKey })
      const status = await app.call(app.alice, 'GET', adminPath)
      expect(response.body).not.toContain(savedKey)
      expect(status.body).not.toContain(savedKey)
      expect(status.json<TranscriptionStatus>().providers[0]).toMatchObject({
        id: 'soniox',
        configured: true,
        keyError: null,
      })
      await waitFor(() => events.some((event) => event.type === 'model.updated'), 'the event')
      expect(JSON.stringify(events)).not.toContain(savedKey)
    })

    it('AC-5: saving again replaces the stored key', async () => {
      const app = await launch()
      await putKey(app, 'soniox', 'first-key')
      await putKey(app, 'soniox', 'second-key')
      expect((await decryptedKey(app, 'soniox')).plain).toEqual({ apiKey: 'second-key' })
    })

    it('AC-6: a key of a provider that is not in use is removed, the one in use stays', async () => {
      const app = await launch()
      await turnOnCloud(app, 'soniox')
      await putKey(app, 'gladia')
      const inUse = await app.call(app.alice, 'DELETE', `${providerPath('soniox')}/secrets`)
      expect(inUse.statusCode).toBe(409)
      expect(inUse.json()).toMatchObject({ error: { code: 'engine_in_use' } })
      const removed = await app.call(app.alice, 'DELETE', `${providerPath('gladia')}/secrets`)
      expect(removed.statusCode).toBe(200)
      expect((await decryptedKey(app, 'gladia')).row).toBeUndefined()
      expect((await decryptedKey(app, 'soniox')).row).toBeDefined()
      const again = await app.call(app.alice, 'DELETE', `${providerPath('gladia')}/secrets`)
      expect(again.statusCode).toBe(200)
    })

    it('AC-7: a typed key is checked without saving it, a saved key with an empty body', async () => {
      const app = await launch()
      const server = app.cloudServer
      server.behaviour.validKey = 'good-key'
      const test = (body: object) =>
        app.call(app.alice, 'POST', `${providerPath('soniox')}/test`, body)

      const noKey = await test({})
      expect(noKey.statusCode).toBe(409)
      expect(noKey.json()).toMatchObject({ error: { code: 'api_key_missing' } })

      expect((await test({ apiKey: 'good-key' })).json()).toEqual({ result: 'ok' })
      expect((await test({ apiKey: 'bad-key' })).json()).toEqual({ result: 'invalid_key' })
      expect(await copyRowsAndSecrets()).toBe(0)
      const checks = server.callsTo('soniox', 'GET', '/files')
      expect(checks).toHaveLength(2)
      expect(checks[0]?.auth).toBe('bearer')
      expect(server.callsTo('soniox', 'POST', '/files')).toHaveLength(0)

      server.behaviour.status.check = 503
      expect((await test({ apiKey: 'good-key' })).json()).toEqual({ result: 'unreachable' })
      server.behaviour.status = {}
      server.behaviour.refuse = true
      expect((await test({ apiKey: 'good-key' })).json()).toEqual({ result: 'unreachable' })
      server.behaviour.refuse = false

      await putKey(app, 'soniox', 'good-key')
      expect((await test({})).json()).toEqual({ result: 'ok' })
      const gladia = await app.call(app.alice, 'POST', `${providerPath('gladia')}/test`, {
        apiKey: 'good-key',
      })
      expect(gladia.json()).toEqual({ result: 'ok' })
      expect(server.callsTo('gladia', 'GET', '/pre-recorded')[0]?.auth).toBe('x-gladia-key')
    })

    async function copyRowsAndSecrets() {
      return (await database.db.select().from(providerSecrets)).length
    }

    it('AC-8: switching to a provider is at once, keeps the model files and downloads nothing', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const status = await statusOf(app)
      expect(status).toMatchObject({ activeEngine: 'soniox', state: 'ready', totalBytes: 0 })
      expect(status.models[0]?.state).toBe('downloaded')
      await app.call(app.alice, 'PUT', adminPath, { enabled: false })
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      expect(await statusOf(app)).toMatchObject({ activeEngine: 'soniox', state: 'ready' })
      expect(app.modelServer.requests).toEqual([])
      const back = await app.call(app.alice, 'POST', `${adminPath}/models/${testModelId}/use`)
      expect(back.json<TranscriptionStatus>().activeEngine).toBe(testModelId)
    })

    it('AC-9: saving, removing and switching publish the engine and the providers to admins', async () => {
      const app = await launch()
      await app.seedModel()
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitFor(async () => (await statusOf(app)).state === 'ready', 'a ready model')
      const seen: LiveEvent[] = app.hubEvents(app.alice.id, true)
      await putKey(app, 'soniox')
      await putKey(app, 'gladia')
      await useProvider(app, 'soniox')
      await app.call(app.alice, 'DELETE', `${providerPath('gladia')}/secrets`)
      await waitFor(() => seen.length >= 4, 'four events')
      const models = seen.filter((event) => event.type === 'model.updated')
      expect(models.map((event) => event.activeEngine)).toEqual([
        testModelId,
        testModelId,
        'soniox',
        'soniox',
      ])
      expect(models.at(-1)?.providers.map((provider) => provider.configured)).toEqual([true, false])
      expect(JSON.stringify(models)).not.toContain('usage')
    })

    it('AC-10: usage adds up this month by the engine that transcribed, in the time zone of the asker', async () => {
      const app = await launch({ now: new Date('2026-11-26T20:30:00Z') })
      await putKey(app, 'gladia')
      const [entry] = await database.db
        .insert(entries)
        .values({ userId: app.alice.id, entryDate: '2026-11-26' })
        .returning()
      const add = async (
        model: string,
        minutes: number,
        transcribedAt: string,
        updatedAt = transcribedAt,
      ) => {
        const [recording] = await database.db
          .insert(recordings)
          .values({
            userId: app.alice.id,
            entryId: entry?.id ?? '',
            filePath: 'media/x',
            mimeType: 'audio/webm',
            sizeBytes: 1,
            durationMs: minutes * 60_000,
            language: 'hu',
            status: 'done',
          })
          .returning()
        await database.db.insert(transcripts).values({
          userId: app.alice.id,
          recordingId: recording?.id ?? '',
          model,
          language: 'hu',
          text: 'x',
          transcribedAt: new Date(transcribedAt),
          updatedAt: new Date(updatedAt),
        })
      }
      await add('soniox', 90, '2026-11-03T10:00:00Z')
      await add('soniox', 102, '2026-11-20T10:00:00Z')
      await add('soniox', 60, '2026-10-30T10:00:00Z')
      await add('soniox', 60, '2026-10-20T10:00:00Z', '2026-11-10T10:00:00Z')
      await add(testModelId, 600, '2026-11-05T10:00:00Z')

      const status = (await app.call(app.alice, 'GET', adminPath)).json<TranscriptionStatus>()
      expect(status.usage).toEqual([
        { engine: 'soniox', audioMs: (90 + 102) * 60_000, estimatedCost: 0.32 },
        { engine: 'gladia', audioMs: 0, estimatedCost: 0 },
      ])
    })
  })

  describe('key at rest', () => {
    it('AC-13: a changed instance secret makes the key unreadable, new recordings wait and a new key queues them', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const again = await launchAgain(app, { secretKey: 'ab'.repeat(32) })
      const status = await statusOf(again)
      expect(status.providers[0]).toMatchObject({ configured: false, keyError: 'unreadable' })
      expect(status).toMatchObject({ activeEngine: 'soniox', state: 'needs_key' })
      const saved = await upload(again, sampleAs('webm'))
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(await again.statusOf(saved.id)).toBe('pending')
      expect(again.cloudServer.requests.filter((request) => request.method === 'POST')).toEqual([])

      await putKey(again, 'soniox')
      await waitForStatus(again, saved.id, 'done')
      expect((await statusOf(again)).providers[0]).toMatchObject({
        configured: true,
        keyError: null,
      })
    })

    it('AC-29: with an unreadable key transcribing again is refused', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'done')
      const again = await launchAgain(app, { secretKey: 'cd'.repeat(32) })
      const response = await again.call(
        again.alice,
        'POST',
        `/api/v1/recordings/${saved.id}/retranscribe`,
        {},
      )
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'model_not_ready' } })
    })
  })

  describe('the job with a cloud engine', () => {
    it('AC-14: a Hungarian webm goes through the states and the vendor gets the original bytes', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const events = app.hubEvents(app.alice.id)
      const webm = sampleAs('webm')
      const saved = await upload(app, webm)
      await waitForStatus(app, saved.id, 'done')
      expect(
        events.filter((event) => event.type === 'recording.updated').map((event) => event.status),
      ).toEqual(['pending', 'transcribing', 'done'])

      const server = app.cloudServer
      const [file] = [...server.files.values()]
      expect(file?.name).toBe('audio.webm')
      expect(file?.data.equals(webm)).toBe(true)
      const create = server.callsTo('soniox', 'POST', '/transcriptions')[0]?.json
      expect(create).toMatchObject({ model: 'stt-async-v6', language_hints: ['hu'] })
      expect(create).not.toHaveProperty('enable_language_identification')
      const transcript = await transcriptOf(saved.id)
      expect(transcript).toMatchObject({
        model: 'soniox',
        language: 'hu',
        text: 'Fixture transcript 1',
      })
    })

    it('AC-15: Gladia gets webm as ogg without a re-encode and m4a as it is', async () => {
      const app = await launch()
      await turnOnCloud(app, 'gladia')
      const webm = sampleAs('webm', 'en')
      const first = await upload(app, webm, 'en')
      await waitForStatus(app, first.id, 'done')
      const m4a = sampleAs('m4a')
      const second = await upload(app, m4a, 'hu', 'memo.m4a')
      await waitForStatus(app, second.id, 'done')

      const server = app.cloudServer
      const [ogg, kept] = [...server.files.values()]
      expect(ogg?.data.subarray(0, 4).toString('latin1')).toBe('OggS')
      expect(ogg?.name).toBe('audio.ogg')
      const seen = probe(ogg?.data ?? Buffer.alloc(0), 'ogg')
      expect(seen.codec).toBe('opus')
      expect(Math.abs(seen.seconds - probe(webm, 'webm').seconds)).toBeLessThan(0.1)
      expect(kept?.data.equals(m4a)).toBe(true)
      expect(kept?.name).toBe('audio.m4a')
      const bodies = server.callsTo('gladia', 'POST', '/pre-recorded').map((call) => call.json)
      expect(bodies[0]).toMatchObject({
        model: 'solaria-1',
        language_config: { languages: ['en'] },
      })
      expect(bodies[1]).toMatchObject({ language_config: { languages: ['hu'] } })
    })

    it('AC-16: auto asks for both languages and stores the detected one, a language that is not Hungarian counts as English', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const server = app.cloudServer
      server.behaviour.tokens = [
        { text: 'hello there my friend', language: 'en' },
        { text: 'szia', language: 'hu' },
      ]
      const english = await upload(app, sampleAs('webm', 'en'), 'auto')
      await waitForStatus(app, english.id, 'done')
      const create = server.callsTo('soniox', 'POST', '/transcriptions')[0]?.json
      expect(create).toMatchObject({
        language_hints: ['hu', 'en'],
        enable_language_identification: true,
      })
      expect((await transcriptOf(english.id))?.language).toBe('en')

      server.behaviour.tokens = [{ text: 'Guten Tag zusammen', language: 'de' }]
      const german = await upload(app, sampleAs('webm'), 'auto')
      await waitForStatus(app, german.id, 'done')
      expect((await transcriptOf(german.id))?.language).toBe('en')

      await putKey(app, 'gladia')
      await useProvider(app, 'gladia')
      server.behaviour.detected = 'hu'
      const hungarian = await upload(app, sampleAs('m4a'), 'auto', 'memo.m4a')
      await waitForStatus(app, hungarian.id, 'done')
      expect((await transcriptOf(hungarian.id))?.language).toBe('hu')
      expect(server.callsTo('gladia', 'POST', '/pre-recorded')[0]?.json).toMatchObject({
        language_config: { languages: ['hu', 'en'] },
      })
      server.behaviour.detected = 'de'
      const other = await upload(app, sampleAs('m4a'), 'auto', 'memo.m4a')
      await waitForStatus(app, other.id, 'done')
      expect((await transcriptOf(other.id))?.language).toBe('en')
    })

    describe('a provider with a length limit', () => {
      const limited = (server: CloudServer) => {
        const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
        return [
          { ...soniox, capabilities: { ...soniox.capabilities, maxAudioMs: 60_000 } },
          ...server.providers().slice(1),
        ]
      }

      it('AC-17: a long recording is cut in pauses without re-encoding, sent in order and every copy deleted', async () => {
        const app = await launch({ providers: limited })
        await turnOnCloud(app)
        const server = app.cloudServer
        server.behaviour.texts = ['one', 'two', 'three']
        const saved = await upload(app, pausesOgg(), 'hu', 'long.ogg')
        await waitForStatus(app, saved.id, 'done')

        const parts = [...server.files.values()]
        expect(parts).toHaveLength(3)
        const seen = parts.map((part) => probe(part.data, 'ogg'))
        for (const part of seen) {
          expect(part.codec).toBe('opus')
          expect(part.seconds).toBeLessThan(60)
        }
        const first = seen[0]?.seconds ?? 0
        const second = first + (seen[1]?.seconds ?? 0)
        expect(first).toBeGreaterThan(48.4)
        expect(first).toBeLessThan(49.6)
        expect(second).toBeGreaterThan(100.4)
        expect(second).toBeLessThan(101.6)
        expect((await transcriptOf(saved.id))?.text).toBe('one two three')
        expect(server.undeleted()).toBe(0)
        expect(await copyRows()).toEqual([])
      })

      it('AC-17: a recording under the limit is sent as one part', async () => {
        const app = await launch({ providers: limited })
        await turnOnCloud(app)
        const saved = await upload(app, sampleAs('webm'))
        await waitForStatus(app, saved.id, 'done')
        expect(app.cloudServer.files.size).toBe(1)
      })
    })

    it('AC-18: after a done and after a failed attempt every copy is deleted at the vendor and the table is empty', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const server = app.cloudServer
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'done')
      expect(server.callsTo('soniox', 'DELETE', '/transcriptions')).toHaveLength(1)
      expect(server.callsTo('soniox', 'DELETE', '/files')).toHaveLength(1)
      expect(server.undeleted()).toBe(0)
      expect(await copyRows()).toEqual([])

      server.behaviour.jobError = true
      const failed = await upload(app, sampleAs('webm'))
      await waitForStatus(app, failed.id, 'failed')
      expect(server.callsTo('soniox', 'DELETE', '/transcriptions')).toHaveLength(2)
      expect(server.undeleted()).toBe(0)
      expect(await copyRows()).toEqual([])

      server.behaviour.jobError = false
      await putKey(app, 'gladia')
      await useProvider(app, 'gladia')
      const viaGladia = await upload(app, sampleAs('webm'))
      await waitForStatus(app, viaGladia.id, 'done')
      expect(server.callsTo('gladia', 'DELETE', '/pre-recorded')).toHaveLength(1)
      expect(server.undeleted()).toBe(0)
    })

    it('AC-19: a delete that fails leaves the recording done and a cleanup job deletes the copy on retry', async () => {
      const app = await launch({ jobs: { cleanupRetryDelaySeconds: 0 } })
      await turnOnCloud(app)
      const server = app.cloudServer
      server.behaviour.failDeletes = 4
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'done')
      await waitFor(async () => (await copyRows()).length === 0, 'the cleanup to finish')
      expect(server.undeleted()).toBe(0)
      const warnings = app.capture.lines().filter((line) => line.msg === 'provider cleanup failed')
      expect(warnings.length).toBe(2)
      for (const line of warnings) {
        expect(
          Object.keys(line)
            .filter((key) => !['level', 'time', 'msg'].includes(key))
            .sort(),
        ).toEqual(['provider', 'reason'])
        expect(line.provider).toBe('soniox')
        expect(line.reason).toBe('http_500')
      }
    })

    it('AC-19: when every retry fails the cleanup gives up and the row stays', async () => {
      const app = await launch({ jobs: { cleanupRetryDelaySeconds: 0 } })
      await turnOnCloud(app)
      app.cloudServer.behaviour.failDeletes = 1000
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'done')
      await waitFor(
        () => app.capture.lines().some((line) => line.msg === 'provider cleanup gave up'),
        'the cleanup to give up',
      )
      expect(await app.statusOf(saved.id)).toBe('done')
      expect((await copyRows()).length).toBe(1)
    })

    it('AC-20: a copy left by a stopped server is deleted when the server starts', async () => {
      const app = await launch({ cloud: { cleanupMinAgeMs: 60_000 } })
      await turnOnCloud(app)
      const server = app.cloudServer
      server.files.set('sf-left', { data: Buffer.from('x'), name: 'audio.webm', deleted: false })
      await database.db.insert(cloudCopies).values({
        providerId: 'soniox',
        vendorRef: { fileId: 'sf-left' },
        createdAt: new Date(Date.now() - 120_000),
      })
      await database.db.insert(cloudCopies).values({
        providerId: 'soniox',
        vendorRef: { fileId: 'sf-fresh' },
      })
      server.files.set('sf-fresh', { data: Buffer.from('x'), name: 'audio.webm', deleted: false })
      await launchAgain(app, { cloud: { cleanupMinAgeMs: 60_000 } })
      await waitFor(() => server.files.get('sf-left')?.deleted, 'the left copy to be deleted')
      expect(server.files.get('sf-fresh')?.deleted).toBe(false)
      expect((await copyRows()).map((row) => row.vendorRef)).toEqual([{ fileId: 'sf-fresh' }])
    })

    it('AC-20: the next attempt of a recording deletes its leftovers before it uploads', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const server = app.cloudServer
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'done')
      server.requests.length = 0
      server.files.set('sf-old', { data: Buffer.from('x'), name: 'audio.webm', deleted: false })
      await database.db.insert(cloudCopies).values({
        providerId: 'soniox',
        recordingId: saved.id,
        userId: app.alice.id,
        vendorRef: { fileId: 'sf-old' },
      })
      const response = await app.call(
        app.alice,
        'POST',
        `/api/v1/recordings/${saved.id}/retranscribe`,
        {},
      )
      expect(response.statusCode).toBe(200)
      await waitFor(
        () => server.callsTo('soniox', 'POST', '/files').length === 1,
        'the second upload',
      )
      await waitForStatus(app, saved.id, 'done')
      const order = server.requests.map((request) => `${request.method} ${request.path}`)
      expect(order.indexOf('DELETE /files/sf-old')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('DELETE /files/sf-old')).toBeLessThan(order.indexOf('POST /files'))
    })

    it('AC-21: a switch never interrupts a running job in either direction', async () => {
      const app = await launch()
      await app.seedModel()
      await app.call(app.alice, 'PUT', adminPath, { enabled: true })
      await waitFor(async () => (await statusOf(app)).state === 'ready', 'a ready model')
      await putKey(app, 'soniox')
      const release = app.fake.holdJobs()
      const first = await upload(app, sampleAs('webm'))
      await waitFor(() => app.fake.state.calls.length === 1, 'the Turbo job')
      await useProvider(app, 'soniox')
      release()
      await waitForStatus(app, first.id, 'done')
      expect((await transcriptOf(first.id))?.model).toBe(testModelId)
      expect(app.cloudServer.requests.filter((request) => request.method === 'POST')).toEqual([])

      const second = await upload(app, sampleAs('webm'))
      await waitForStatus(app, second.id, 'done')
      expect((await transcriptOf(second.id))?.model).toBe('soniox')
      expect(app.fake.state.liveFor[testModelId]).toBe(0)

      app.cloudServer.behaviour.pollsUntilDone = 30
      const polled = () => app.cloudServer.callsTo('soniox', 'GET', '/transcriptions').length
      const before = polled()
      const third = await upload(app, sampleAs('webm'))
      await waitFor(() => polled() >= before + 2, 'the Soniox job to poll')
      await app.call(app.alice, 'POST', `${adminPath}/models/${testModelId}/use`)
      await waitForStatus(app, third.id, 'done')
      expect((await transcriptOf(third.id))?.model).toBe('soniox')
    })
  })

  describe('failures', () => {
    const attempts = (app: App) => app.cloudServer.callsTo('soniox', 'POST', '/files').length

    it('AC-22: a rejected key fails the recording at once with no retries and no local transcriber', async () => {
      const app = await launch()
      await turnOnCloud(app)
      app.cloudServer.behaviour.validKey = 'another-key'
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'failed')
      expect((await recordingRow(saved.id))?.failure).toBe('api_key_invalid')
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(attempts(app)).toBe(1)
      expect(app.fake.state.createdInstances).toBe(0)
      expect(await app.statusOf(saved.id)).toBe('failed')
    })

    it('AC-23: no credit and a vendor job in its error state both fail after one attempt', async () => {
      const app = await launch()
      await turnOnCloud(app)
      app.cloudServer.behaviour.status.upload = 402
      const broke = await upload(app, sampleAs('webm'))
      await waitForStatus(app, broke.id, 'failed')
      expect((await recordingRow(broke.id))?.failure).toBe('quota_exceeded')

      app.cloudServer.behaviour.status = {}
      app.cloudServer.behaviour.jobError = true
      const rejected = await upload(app, sampleAs('webm'))
      await waitForStatus(app, rejected.id, 'failed')
      expect((await recordingRow(rejected.id))?.failure).toBe('audio_rejected')
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(attempts(app)).toBe(2)
    })

    it('AC-24: a vendor that is down is tried three times, then the recording fails with provider_unavailable', async () => {
      const app = await launch()
      await turnOnCloud(app)
      app.cloudServer.behaviour.status.upload = 503
      const down = await upload(app, sampleAs('webm'))
      await waitForStatus(app, down.id, 'failed')
      expect((await recordingRow(down.id))?.failure).toBe('provider_unavailable')
      expect(attempts(app)).toBe(3)

      app.cloudServer.behaviour.status = {}
      app.cloudServer.behaviour.refuse = true
      const refused = await upload(app, sampleAs('webm'))
      await waitForStatus(app, refused.id, 'failed')
      expect((await recordingRow(refused.id))?.failure).toBe('provider_unavailable')
      expect(attempts(app)).toBe(6)
    })

    it('AC-24: polls that never finish end each attempt at the deadline and the recording ends as timeout', async () => {
      const app = await launch({ cloud: { partDeadlineMs: () => 300 } })
      await turnOnCloud(app)
      app.cloudServer.behaviour.pollsUntilDone = Number.POSITIVE_INFINITY
      const saved = await upload(app, sampleAs('webm'))
      await waitForStatus(app, saved.id, 'failed')
      expect((await recordingRow(saved.id))?.failure).toBe('timeout')
      expect(attempts(app)).toBe(3)
      expect(app.cloudServer.undeleted()).toBe(0)
      expect(await copyRows()).toEqual([])
    })

    it('AC-25: transcribing again clears the reason and a failing one keeps the old transcript', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const server = app.cloudServer
      server.behaviour.validKey = 'another-key'
      const failed = await upload(app, sampleAs('webm'))
      await waitForStatus(app, failed.id, 'failed')
      expect((await recordingRow(failed.id))?.failure).toBe('api_key_invalid')
      server.behaviour.validKey = undefined
      const retry = await app.call(app.alice, 'POST', `/api/v1/recordings/${failed.id}/retry`)
      expect(retry.statusCode).toBe(200)
      expect(retry.json()).toMatchObject({ status: 'pending', failure: null })
      await waitForStatus(app, failed.id, 'done')
      expect((await recordingRow(failed.id))?.failure).toBeNull()
      const first = (await transcriptOf(failed.id))?.text

      server.behaviour.validKey = 'another-key'
      const again = await app.call(
        app.alice,
        'POST',
        `/api/v1/recordings/${failed.id}/retranscribe`,
        {},
      )
      expect(again.json()).toMatchObject({ status: 'pending', failure: null })
      await waitForStatus(app, failed.id, 'failed')
      const listed = await app.call(
        app.alice,
        'GET',
        `/api/v1/entries/${failed.entryId}/recordings`,
      )
      expect(listed.json()).toMatchObject([
        { status: 'failed', failure: 'api_key_invalid', transcript: { text: first } },
      ])
    })
  })

  describe('access and privacy', () => {
    it('AC-28: a user who is not an admin learns which engine is in use', async () => {
      const app = await launch()
      await turnOnCloud(app)
      const response = await app.call(app.bob, 'GET', '/api/v1/transcription')
      expect(response.json()).toEqual({
        state: 'ready',
        engine: { id: 'soniox', kind: 'cloud' },
      })
    })

    it('AC-30: only admins reach the provider routes, an unknown provider is 404 and bad key bodies save nothing', async () => {
      const app = await launch()
      for (const [method, path] of [
        ['PUT', `${providerPath('soniox')}/secrets`],
        ['DELETE', `${providerPath('soniox')}/secrets`],
        ['POST', `${providerPath('soniox')}/test`],
        ['POST', `${providerPath('soniox')}/use`],
      ] as const) {
        expect((await app.call(app.bob, method, path, { apiKey: 'x' })).statusCode).toBe(403)
        expect((await app.call(null, method, path, { apiKey: 'x' })).statusCode).toBe(401)
      }
      const unknown = await app.call(app.alice, 'PUT', `${providerPath('nope')}/secrets`, {
        apiKey: 'x',
      })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toMatchObject({ error: { code: 'unknown_provider' } })
      for (const body of [
        { apiKey: 'x', extra: 1 },
        { apiKey: '' },
        { apiKey: '   ' },
        { apiKey: 'x'.repeat(513) },
        {},
        { apiKey: 5 },
      ]) {
        const response = await putKey(app, 'soniox').then(() =>
          app.call(app.alice, 'PUT', `${providerPath('gladia')}/secrets`, body),
        )
        expect(response.statusCode).toBe(400)
      }
      expect(
        (await database.db.select().from(providerSecrets)).map((row) => row.providerId),
      ).toEqual(['soniox'])
      await putKey(app, 'gladia', `  ${'k'.repeat(512)}  `)
      expect((await decryptedKey(app, 'gladia')).plain).toEqual({ apiKey: 'k'.repeat(512) })
    })

    it('AC-31: a marker used as key, file name and transcript text stays out of logs and responses', async () => {
      const keyMarker = 'ZQX-KEY-4412'
      const textMarker = 'ZQX-PRIVATE-7781'
      const app = await launch({
        providers: (server) => {
          const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
          return [
            { ...soniox, capabilities: { ...soniox.capabilities, maxAudioMs: 60_000 } },
            ...server.providers().slice(1),
          ]
        },
      })
      const responses: string[] = []
      const track = async <T extends { body: string }>(pending: Promise<T>) => {
        const response = await pending
        responses.push(response.body)
        return response
      }
      await app.seedModel()
      await track(app.call(app.alice, 'PUT', adminPath, { enabled: true }))
      await waitFor(async () => (await statusOf(app)).state === 'ready', 'a ready model')
      const server = app.cloudServer
      server.behaviour.validKey = keyMarker
      server.behaviour.texts = [textMarker]
      await track(putKey(app, 'soniox', 'old-key'))
      await track(putKey(app, 'soniox', keyMarker))
      await track(
        app.call(app.alice, 'POST', `${providerPath('soniox')}/test`, { apiKey: keyMarker }),
      )
      await track(app.call(app.alice, 'POST', `${providerPath('soniox')}/test`, {}))
      await track(putKey(app, 'gladia', keyMarker))
      await track(useProvider(app, 'soniox'))

      const oneName = { data: sampleAs('webm'), name: `${textMarker}.webm` }
      const done = await app.uploadVoice(
        app.alice,
        { language: 'hu', entryDate: '2026-11-26' },
        oneName,
      )
      await waitForStatus(app, done.id, 'done')
      const split = await upload(app, pausesOgg(), 'hu', `${textMarker}.ogg`)
      await waitForStatus(app, split.id, 'done')
      expect(server.callsTo('soniox', 'POST', '/files').map((call) => call.fileName)).toEqual([
        'audio.webm',
        'audio.ogg',
        'audio.ogg',
        'audio.ogg',
      ])

      server.behaviour.failDeletes = 2
      const withBadDelete = await upload(app, sampleAs('webm'))
      await waitForStatus(app, withBadDelete.id, 'done')
      server.behaviour.jobError = true
      const failing = await upload(app, sampleAs('webm'))
      await waitForStatus(app, failing.id, 'failed')
      server.behaviour.jobError = false
      server.behaviour.status.upload = 503
      const unavailable = await upload(app, sampleAs('webm'))
      await waitForStatus(app, unavailable.id, 'failed')
      server.behaviour.status = {}
      await putKey(app, 'gladia', keyMarker)
      await useProvider(app, 'gladia')
      const viaGladia = await upload(app, sampleAs('webm'))
      await waitForStatus(app, viaGladia.id, 'done')
      responses.push((await app.call(app.alice, 'GET', adminPath)).body)
      responses.push(
        (await app.call(app.alice, 'GET', `/api/v1/entries/${done.entryId}/recordings`)).body,
      )

      const logs = app.capture.text()
      expect(logs.length).toBeGreaterThan(0)
      expect(logs).not.toContain(keyMarker)
      expect(logs).not.toContain(textMarker)
      expect(logs).not.toContain('Fixture')
      expect(responses.join('\n')).not.toContain(keyMarker)
      expect(responses.slice(0, -1).join('\n')).not.toContain(textMarker)

      const columns = (
        await database.db.execute<{ table_name: string; column_name: string }>(sql`
          select table_name, column_name from information_schema.columns
          where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')`)
      ).rows
      for (const { table_name, column_name } of columns) {
        const found = await database.db.execute(
          sql.raw(
            `select 1 from "${table_name}" where "${column_name}"::text like '%${keyMarker}%' limit 1`,
          ),
        )
        expect(found.rows, `${table_name}.${column_name}`).toEqual([])
      }
    })
  })

  describe('upgrading from spec 009', () => {
    it('AC-33: a database at migration 0010 keeps its model as the active engine and its transcript time, and sends nothing', async () => {
      const name = `upgrade010_${String(Date.now())}`
      await database.db.execute(sql.raw(`create database ${name}`))
      const base = new URL(postgres.getConnectionUri())
      base.pathname = `/${name}`
      const old = createDatabase(base.toString(), createLogger({ level: 'silent' }))
      cleanups.push(async () => {
        const admin = new Client({ connectionString: postgres.getConnectionUri() })
        await admin.connect()
        await admin.query(`drop database ${name} with (force)`)
        await admin.end()
      })
      cleanups.push(() => old.close())

      const real = join(import.meta.dirname, '../migrations')
      const folder = mkdtempSync(join(tmpdir(), 'nightjar-migrations-'))
      const { cpSync } = await import('node:fs')
      cpSync(real, folder, { recursive: true })
      const journalPath = join(folder, 'meta', '_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number }[]
      }
      journal.entries = journal.entries.filter((entry) => entry.idx <= 10)
      writeFileSync(journalPath, JSON.stringify(journal))
      await old.migrate(folder)
      await old.db.execute(sql`
        insert into instance_settings (id, transcription_enabled, auth_secret, active_model)
        values (1, true, 'secret', 'whisper-large-v3-int8')`)
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
      await old.db.execute(sql`
        insert into transcripts (user_id, recording_id, model, language, text, created_at)
        values (${user?.id ?? ''}, ${recordingRows.rows[0]?.id ?? ''}, 'whisper-large-v3-int8', 'hu', 'régi', '2026-11-02T08:00:00Z')`)

      await old.migrate(real)
      const [settings] = (
        await old.db.execute<{ active_engine: string }>(
          sql`select active_engine from instance_settings`,
        )
      ).rows
      expect(settings?.active_engine).toBe('whisper-large-v3-int8')
      const [moved] = (
        await old.db.execute<{ same: boolean }>(
          sql`select transcribed_at = created_at as same from transcripts`,
        )
      ).rows
      expect(moved?.same).toBe(true)

      const dataDir = mkdtempSync(join(tmpdir(), 'nightjar-data-'))
      const logger = createLogger({ level: 'silent' })
      const secret = await resolveInstanceSecret({ env: undefined, dataDir, logger })
      expect(readFileSync(join(dataDir, 'secret.key'), 'utf8').trim()).toHaveLength(64)
      const cloudServer = await startCloudServer()
      cleanups.push(() => cloudServer.close())
      const modelServer = await startModelServer()
      cleanups.push(() => modelServer.close())
      const service = createTranscriptionService({
        database: old,
        storage: createStorage(dataDir),
        jobs: createJobs(base.toString(), logger),
        events: createEvents({ databaseUrl: base.toString(), database: old, logger }),
        logger,
        models: modelServer.list,
        providers: cloudServer.providers(),
        keys: createKeyStore(old, createSecretBox(secret)),
      })
      const status = await service.status()
      expect(status.activeEngine).toBe('whisper-large-v3-int8')
      expect(status.providers.map((provider) => provider.configured)).toEqual([false, false])
      expect(modelServer.requests).toEqual([])
      expect(cloudServer.requests).toEqual([])
    })
  })
})

describe('010-cloud-transcription: the instance secret at start', () => {
  it('AC-12: a bad env value or a bad secret file stops the start with a log line that holds no key characters', async () => {
    const { start } = await import('../src/start.ts')
    const { loadConfig } = await import('../src/config.ts')
    const dataDir = mkdtempSync(join(tmpdir(), 'nightjar-secret-'))
    writeFileSync(join(dataDir, 'secret.key'), `${'z'.repeat(64)}\n`)
    const capture = captureLogs()
    const logger = createLogger({ level: 'info', stream: capture.stream })
    const config = loadConfig({
      DATABASE_URL: 'postgres://localhost:1/unused',
      PORT: '0',
      NIGHTJAR_DATA_DIR: dataDir,
    })
    await expect(
      start({ config, logger, migrationsFolder: '/unused', exit: () => undefined }),
    ).rejects.toThrow('64 hex')
    const [line] = capture.lines()
    expect(line).toMatchObject({ level: 'fatal', source: 'file' })
    expect(capture.text()).not.toContain('zzzz')
  })
})
