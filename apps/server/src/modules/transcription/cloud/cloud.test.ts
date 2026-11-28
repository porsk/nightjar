import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { pausesOgg, probe, sampleAs } from '../../../../test/support/audio.ts'
import { startCloudServer, type CloudServer } from '../../../../test/support/cloud-server.ts'
import { captureLogs } from '../../../../test/support/log-capture.ts'
import { createLogger } from '../../../logger.ts'
import { expiryFor } from '../../../jobs.ts'
import { supportedModels } from '../models.ts'
import { createGladiaProvider } from './gladia.ts'
import { ProviderError, type AudioExtension, type ProviderCall } from './provider.ts'
import { cloudProviders, containerFor, copyTargets } from './registry.ts'
import { createSecretBox, resolveInstanceSecret } from './secrets.ts'
import { createSonioxProvider, dominantLanguage } from './soniox.ts'
import { makeParts, planCuts } from './split.ts'
import { estimatedCost, monthStart } from './usage.ts'

const storedFormats: AudioExtension[] = ['webm', 'ogg', 'm4a', 'aac', 'mp3', 'wav', 'flac']
const noSignal = () => new AbortController().signal

describe('010-cloud-transcription: providers, keys and splitting', () => {
  describe('registry', () => {
    it('AC-1: Soniox and Gladia declare the specified values and every stored format can be sent', () => {
      const [soniox, gladia] = cloudProviders
      expect(cloudProviders.map((provider) => provider.id)).toEqual(['soniox', 'gladia'])
      expect([soniox?.label, soniox?.secrets, soniox?.capabilities, soniox?.pricePerHour]).toEqual([
        'Soniox',
        [{ id: 'apiKey', kind: 'secret' }],
        {
          maxAudioMs: null,
          formats: ['webm', 'ogg', 'm4a', 'aac', 'mp3', 'wav', 'flac'],
          languages: ['hu', 'en'],
        },
        { amount: 0.1, currency: 'USD' },
      ])
      expect([gladia?.label, gladia?.secrets, gladia?.capabilities, gladia?.pricePerHour]).toEqual([
        'Gladia',
        [{ id: 'apiKey', kind: 'secret' }],
        {
          maxAudioMs: 135 * 60_000,
          formats: ['ogg', 'm4a', 'aac', 'mp3', 'wav', 'flac'],
          languages: ['hu', 'en'],
        },
        { amount: 0.27, currency: 'EUR' },
      ])
      const ids = [
        ...supportedModels.models.map((model) => model.id),
        ...cloudProviders.map((provider) => provider.id),
      ]
      expect(new Set(ids).size).toBe(ids.length)
      for (const provider of cloudProviders) {
        expect(provider.capabilities.languages).toEqual(expect.arrayContaining(['hu', 'en']))
        for (const format of storedFormats) {
          const sent = containerFor(provider, format)
          expect(sent, `${provider.id} ${format}`).toBeDefined()
          expect(provider.capabilities.formats).toContain(sent)
        }
      }
    })

    it('AC-15: a container the provider does not take is sent as its stream-copy target', () => {
      const soniox = createSonioxProvider()
      const gladia = createGladiaProvider()
      expect(copyTargets).toEqual({ webm: 'ogg' })
      expect(containerFor(soniox, 'webm')).toBe('webm')
      expect(containerFor(gladia, 'webm')).toBe('ogg')
      expect(containerFor(gladia, 'm4a')).toBe('m4a')
    })

    it('AC-26: a job may run for the larger of 30 minutes and five times the audio', () => {
      expect(expiryFor(0)).toBe(1800)
      expect(expiryFor(60_000)).toBe(1800)
      expect(expiryFor(6 * 60_000)).toBe(1800)
      expect(expiryFor(2 * 60 * 60_000)).toBe(36_000)
    })
  })

  describe('the vendor modules against the fixture server', () => {
    let server: CloudServer
    let folder: string
    let file: { path: string; extension: AudioExtension }

    beforeAll(async () => {
      server = await startCloudServer()
      folder = mkdtempSync(join(tmpdir(), 'nightjar-cloud-'))
      writeFileSync(join(folder, 'in.ogg'), Buffer.from('OggS-fake-audio'))
      file = { path: join(folder, 'in.ogg'), extension: 'ogg' }
    })
    afterAll(() => server.close())
    afterEach(() => {
      server.reset()
      vi.useRealTimers()
    })

    const callWith = (apiKey = 'k', fetchFn: typeof fetch = fetch): ProviderCall => ({
      secrets: { apiKey },
      fetch: fetchFn,
      signal: noSignal(),
    })

    it('AC-7: the key check says ok, invalid key or unreachable for each kind of answer', async () => {
      const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
      const gladia = createGladiaProvider({ baseUrl: `${server.origin}/gladia/v2` })
      for (const provider of [soniox, gladia]) {
        expect(await provider.checkKey(callWith())).toBe('ok')
        server.behaviour.rejectKey = true
        expect(await provider.checkKey(callWith())).toBe('invalid_key')
        server.behaviour.rejectKey = false
        server.behaviour.status.check = 403
        expect(await provider.checkKey(callWith())).toBe('invalid_key')
        server.behaviour.status.check = 503
        expect(await provider.checkKey(callWith())).toBe('unreachable')
        server.behaviour.status = {}
        server.behaviour.refuse = true
        expect(await provider.checkKey(callWith())).toBe('unreachable')
        server.behaviour.refuse = false
      }
      expect(server.callsTo('soniox', 'POST', '/files')).toHaveLength(0)
    })

    it('AC-7: a check that takes more than 10 seconds counts as unreachable', async () => {
      vi.useFakeTimers()
      const hanging = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })) as unknown as typeof fetch
      const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
      const result = soniox.checkKey(callWith('k', hanging))
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await result).toBe('unreachable')
    })

    it('AC-16: Soniox takes the language with the most token characters and a language that is not Hungarian is English', () => {
      expect(
        dominantLanguage([
          { text: 'szia', language: 'hu' },
          { text: 'hello there friend', language: 'en' },
        ]),
      ).toBe('en')
      expect(dominantLanguage([{ text: 'jó napot kívánok', language: 'hu' }])).toBe('hu')
      expect(dominantLanguage([{ text: 'Guten Tag', language: 'de' }])).toBe('en')
      expect(dominantLanguage(undefined)).toBe('en')
    })

    it('AC-18: a copy is deleted completely and "not found" counts as deleted', async () => {
      const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
      const call = callWith()
      const uploaded = await soniox.upload(call, file)
      const started = await soniox.start(call, uploaded, 'hu')
      expect(await soniox.remove(call, started)).toBe('deleted')
      expect(server.undeleted()).toBe(0)
      expect(await soniox.remove(call, started)).toBe('deleted')
      const polled = soniox.poll(call, started)
      await expect(polled).rejects.toBeInstanceOf(ProviderError)
    })

    it('AC-18: a Gladia upload without a job has nothing to delete with', async () => {
      const gladia = createGladiaProvider({ baseUrl: `${server.origin}/gladia/v2` })
      const call = callWith()
      const uploaded = await gladia.upload(call, file)
      expect(await gladia.remove(call, uploaded)).toBe('no_delete_api')
      const started = await gladia.start(call, uploaded, 'en')
      expect(await gladia.remove(call, started)).toBe('deleted')
      expect(await gladia.remove(call, started)).toBe('deleted')
    })

    it('AC-14: a Soniox job goes upload, start, poll until done and gives the text and the language', async () => {
      const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
      const call = callWith()
      server.behaviour.pollsUntilDone = 1
      server.behaviour.texts = ['Szia világ']
      const uploaded = await soniox.upload(call, file)
      const started = await soniox.start(call, uploaded, 'hu')
      expect(await soniox.poll(call, started)).toEqual({ state: 'running' })
      expect(await soniox.poll(call, started)).toEqual({
        state: 'done',
        text: 'Szia világ',
        language: 'hu',
      })
      expect(server.callsTo('soniox', 'POST', '/files')[0]?.fileName).toBe('audio.ogg')
    })

    it('AC-14: a Gladia job gives the text and the language it reports', async () => {
      const gladia = createGladiaProvider({ baseUrl: `${server.origin}/gladia/v2` })
      const call = callWith()
      server.behaviour.texts = ['Hello']
      const uploaded = await gladia.upload(call, file)
      const started = await gladia.start(call, uploaded, 'en')
      expect(await gladia.poll(call, started)).toEqual({
        state: 'done',
        text: 'Hello',
        language: 'en',
      })
      server.behaviour.jobError = true
      const failed = await gladia.poll(call, started).catch((caught: unknown) => caught)
      expect((failed as ProviderError).code).toBe('audio_rejected')
    })

    it('AC-24: the vendor answers map to failure codes without carrying a body', async () => {
      const soniox = createSonioxProvider({ baseUrl: `${server.origin}/soniox/v1` })
      const codes: [number, string][] = [
        [401, 'api_key_invalid'],
        [402, 'quota_exceeded'],
        [429, 'provider_unavailable'],
        [503, 'provider_unavailable'],
        [400, 'audio_rejected'],
      ]
      for (const [status, code] of codes) {
        server.behaviour.status.upload = status
        const error = await soniox.upload(callWith(), file).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ProviderError)
        expect((error as ProviderError).code).toBe(code)
        expect((error as ProviderError).httpStatus).toBe(status)
        expect((error as ProviderError).message).toBe(code)
      }
      server.behaviour.status = { poll: 404 }
      const gone = await soniox.poll(callWith(), { transcriptionId: 'x' }).catch((c: unknown) => c)
      expect((gone as ProviderError).code).toBe('provider_unavailable')
    })
  })

  describe('splitting', () => {
    it('AC-17: the cuts go to the middle of the pause closest to each target and stay on the target without one', () => {
      expect(planCuts(50_000, 60_000, [])).toEqual([])
      const silences = [
        { startSeconds: 48.5, endSeconds: 49.5 },
        { startSeconds: 100.5, endSeconds: 101.5 },
        { startSeconds: 10, endSeconds: 11 },
      ]
      expect(planCuts(150_000, 60_000, silences)).toEqual([49, 101])
      expect(planCuts(150_000, 60_000, [{ startSeconds: 10, endSeconds: 11 }])).toEqual([50, 100])
      const cuts = planCuts(150_000, 60_000, silences)
      const edges = [0, ...cuts, 150]
      for (let index = 1; index < edges.length; index++) {
        expect((edges[index] ?? 0) - (edges[index - 1] ?? 0)).toBeLessThan(60)
      }
      expect(planCuts(3 * 60 * 60_000, 135 * 60_000, [])).toEqual([5400])
    })

    it('AC-17: makeParts leaves a short recording alone and cuts a long one in its pauses by stream copy', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'nightjar-parts-'))
      const longFile = join(dir, 'long.ogg')
      writeFileSync(longFile, pausesOgg())
      const seconds = probe(pausesOgg(), 'ogg').seconds
      const same = await makeParts({
        input: longFile,
        stored: 'ogg',
        container: 'ogg',
        durationMs: seconds * 1000,
        maxAudioMs: null,
        folder: dir,
      })
      expect(same).toEqual([{ path: longFile, durationMs: seconds * 1000 }])

      const folder = mkdtempSync(join(tmpdir(), 'nightjar-parts-out-'))
      const parts = await makeParts({
        input: longFile,
        stored: 'ogg',
        container: 'ogg',
        durationMs: seconds * 1000,
        maxAudioMs: 60_000,
        folder,
      })
      expect(parts).toHaveLength(3)
      const lengths = parts.map((part) => probe(readFileSync(part.path), 'ogg'))
      for (const length of lengths) expect(length.seconds).toBeLessThan(60)
      expect(lengths[0]?.seconds).toBeGreaterThan(48.4)
      expect(lengths[0]?.seconds).toBeLessThan(49.6)
      expect(parts.reduce((sum, part) => sum + part.durationMs, 0)).toBeCloseTo(seconds * 1000, -1)
    })

    it('AC-15: makeParts remuxes webm to ogg and keeps the opus audio and length', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'nightjar-remux-'))
      const input = join(dir, 'in.webm')
      const webm = sampleAs('webm')
      writeFileSync(input, webm)
      const folder = mkdtempSync(join(tmpdir(), 'nightjar-remux-out-'))
      const [part] = await makeParts({
        input,
        stored: 'webm',
        container: 'ogg',
        durationMs: probe(webm, 'webm').seconds * 1000,
        maxAudioMs: null,
        folder,
      })
      const made = readFileSync(part?.path ?? '')
      expect(made.subarray(0, 4).toString('latin1')).toBe('OggS')
      expect(probe(made, 'ogg').codec).toBe('opus')
      expect(Math.abs(probe(made, 'ogg').seconds - probe(webm, 'webm').seconds)).toBeLessThan(0.1)
    })
  })

  describe('usage', () => {
    it('AC-10: the cost is hours times the list price rounded to cents and the month starts at midnight in the time zone', () => {
      expect(estimatedCost(11_520_000, 0.1)).toBe(0.32)
      expect(estimatedCost(0, 0.27)).toBe(0)
      expect(estimatedCost(3_600_000, 0.27)).toBe(0.27)
      const now = new Date('2026-11-26T20:30:00Z')
      expect(monthStart(now, 'UTC').toISOString()).toBe('2026-11-01T00:00:00.000Z')
      expect(monthStart(now, 'Europe/Budapest').toISOString()).toBe('2026-10-31T23:00:00.000Z')
      expect(monthStart(now, 'America/Los_Angeles').toISOString()).toBe('2026-11-01T07:00:00.000Z')
      expect(monthStart(new Date('2026-10-26T10:00:00Z'), 'Europe/Budapest').toISOString()).toBe(
        '2026-09-30T22:00:00.000Z',
      )
      expect(monthStart(new Date('2026-10-31T23:30:00Z'), 'Europe/Budapest').toISOString()).toBe(
        '2026-10-31T23:00:00.000Z',
      )
    })
  })

  describe('the instance secret and the key box', () => {
    const secret = Buffer.alloc(32, 7)
    const box = createSecretBox(secret)

    it('AC-11: a round trip returns the input and anything changed fails to decrypt', () => {
      const fields = { apiKey: 'sk-test-ä' }
      const stored = box.encrypt('soniox', fields)
      expect(stored.startsWith('v1.')).toBe(true)
      expect(stored).not.toContain('sk-test')
      expect(box.decrypt('soniox', stored)).toEqual(fields)
      expect(box.encrypt('soniox', fields)).not.toBe(stored)

      const [tag, iv, authTag, data] = stored.split('.') as [string, string, string, string]
      const flip = (value: string) => (value[0] === 'A' ? 'B' : 'A') + value.slice(1)
      expect(() => box.decrypt('soniox', [tag, iv, authTag, flip(data)].join('.'))).toThrow()
      expect(() => box.decrypt('soniox', [tag, iv, flip(authTag), data].join('.'))).toThrow()
      expect(() => box.decrypt('soniox', [tag, flip(iv), authTag, data].join('.'))).toThrow()
      expect(() => box.decrypt('gladia', stored)).toThrow()
      expect(() => createSecretBox(Buffer.alloc(32, 8)).decrypt('soniox', stored)).toThrow()
      expect(() => box.decrypt('soniox', 'v2.a.b.c')).toThrow()
    })

    const silent = createLogger({ level: 'silent' })
    const folder = () => mkdtempSync(join(tmpdir(), 'nightjar-secret-'))

    it('AC-12: without an env value the secret file is made with 64 hex characters and reused', async () => {
      const dataDir = folder()
      const capture = captureLogs()
      const logger = createLogger({ level: 'info', stream: capture.stream })
      const first = await resolveInstanceSecret({ env: undefined, dataDir, logger })
      const content = readFileSync(join(dataDir, 'secret.key'), 'utf8')
      expect(content).toMatch(/^[0-9a-f]{64}\n$/)
      if (process.platform !== 'win32') {
        expect(statSync(join(dataDir, 'secret.key')).mode & 0o777).toBe(0o600)
      }
      const second = await resolveInstanceSecret({ env: undefined, dataDir, logger })
      expect(second.equals(first)).toBe(true)
      expect(capture.lines().map((line) => line.msg)).toEqual([
        'instance secret created file',
        'instance secret from file',
      ])
      expect(capture.text()).not.toContain(content.trim())
    })

    it('AC-12: an env value is used and no file is read or made', async () => {
      const dataDir = folder()
      writeFileSync(join(dataDir, 'secret.key'), 'not hex at all\n')
      const env = 'ab'.repeat(32)
      const used = await resolveInstanceSecret({ env, dataDir, logger: silent })
      expect(used.toString('hex')).toBe(env)
      const empty = folder()
      await resolveInstanceSecret({ env, dataDir: empty, logger: silent })
      expect(() => readFileSync(join(empty, 'secret.key'))).toThrow()
    })

    it('AC-12: an env value or a file of any other form stops the start and the message holds no key characters', async () => {
      const bad = 'q'.repeat(10)
      const failure = (env: string | undefined, dataDir: string) =>
        resolveInstanceSecret({ env, dataDir, logger: silent }).catch((error: unknown) => error)
      const fromEnv = await failure(bad, folder())
      expect(fromEnv).toMatchObject({ source: 'env' })
      expect((fromEnv as Error).message).not.toContain(bad)
      expect(await failure('', folder())).toMatchObject({ source: 'env' })
      const dataDir = folder()
      writeFileSync(
        join(dataDir, 'secret.key'),
        `${bad}
`,
      )
      const fromFile = await failure(undefined, dataDir)
      expect(fromFile).toMatchObject({ source: 'file' })
      expect((fromFile as Error).message).not.toContain(bad)
    })
  })
})
