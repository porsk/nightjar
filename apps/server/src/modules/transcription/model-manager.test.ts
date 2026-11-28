import { readdirSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startModelServer, type ModelServer } from '../../../test/support/model-server.ts'
import { createLogger } from '../../logger.ts'
import { createStorage } from '../../storage.ts'
import { createModelManager, type DownloadStatus } from './model-manager.ts'
import { defaultModel, type ModelInfo } from './models.ts'

describe('003-voice-entries: model download races', () => {
  let server: ModelServer | undefined

  afterEach(async () => {
    await server?.close()
  })

  async function setup() {
    server = await startModelServer()
    server.behaviour.slowMs = 5
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-manager-'))
    const changes: DownloadStatus[] = []
    const onReady = vi.fn()
    const manager = createModelManager({
      storage: createStorage(dir),
      logger: createLogger({ level: 'silent' }),
      onChange: (status) => changes.push(status),
      onReady,
    })
    const model: ModelInfo = defaultModel(server.list)
    return { manager, model, dir, changes, onReady, requests: server.requests }
  }

  it('AC-21: two starts at once make one download', async () => {
    const { manager, model, requests, onReady } = await setup()
    await Promise.all([manager.start(model), manager.start(model)])
    await manager.whenIdle()
    expect(requests).toHaveLength(4)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('AC-25: starting again right after a cancel waits for the old run and ends up ready', async () => {
    const { manager, model, dir, changes, onReady } = await setup()
    await manager.start(model)
    await new Promise((resolve) => setTimeout(resolve, 100))
    manager.cancel()
    expect(manager.status().state).toBe('idle')
    await manager.start(model)
    await manager.whenIdle()
    expect(manager.status()).toMatchObject({ state: 'idle', downloadedBytes: 5_060_000 })
    expect(changes.at(-1)).toMatchObject({ state: 'idle', downloadedBytes: 5_060_000 })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(readdirSync(join(dir, 'models'))).toEqual([model.id])
  })

  it('AC-25: a cancel leaves nothing behind', async () => {
    const { manager, model, dir } = await setup()
    await manager.start(model)
    await new Promise((resolve) => setTimeout(resolve, 100))
    manager.cancel()
    await manager.whenIdle()
    expect(readdirSync(join(dir, 'models')).filter((name) => name.endsWith('.part'))).toEqual([])
    expect(manager.status().state).toBe('idle')
  })

  it('AC-22: the state is downloading as soon as start is called, before anything is awaited', async () => {
    const { manager, model } = await setup()
    const starting = manager.start(model)
    expect(manager.status().state).toBe('downloading')
    await starting
    await manager.whenIdle()
  })
})

describe('009-transcription-models: a full disk', () => {
  let server: ModelServer | undefined

  afterEach(async () => {
    await server?.close()
  })

  it('AC-10: a write that fails with ENOSPC ends as disk_full and removes every file', async () => {
    server = await startModelServer()
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-manager-'))
    const changes: DownloadStatus[] = []
    const onReady = vi.fn()
    const manager = createModelManager({
      storage: createStorage(dir),
      logger: createLogger({ level: 'silent' }),
      onChange: (status) => changes.push(status),
      onReady,
      createWriter: () =>
        new Writable({
          write(_chunk, _encoding, done) {
            done(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }))
          },
        }),
    })
    await manager.start(defaultModel(server.list))
    await manager.whenIdle()
    expect(manager.status()).toMatchObject({ state: 'failed', error: 'disk_full' })
    expect(changes.at(-1)).toMatchObject({ state: 'failed', error: 'disk_full' })
    expect(onReady).not.toHaveBeenCalled()
    expect(readdirSync(join(dir, 'models'))).toEqual([])
  })
})
