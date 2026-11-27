import { readdirSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startModelServer, type ModelServer } from '../../../test/support/model-server.ts'
import { createLogger } from '../../logger.ts'
import { createStorage } from '../../storage.ts'
import { createModelManager, type DownloadStatus } from './model-manager.ts'
import { defaultModel } from './models.ts'

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
      model: defaultModel(server.list),
      logger: createLogger({ level: 'silent' }),
      onChange: (status) => changes.push(status),
      onReady,
    })
    return { manager, dir, changes, onReady, requests: server.requests }
  }

  it('AC-21: two starts at once make one download', async () => {
    const { manager, requests, onReady } = await setup()
    await Promise.all([manager.start(), manager.start()])
    await manager.whenIdle()
    expect(requests).toHaveLength(4)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('AC-25: starting again right after a cancel waits for the old run and ends up ready', async () => {
    const { manager, dir, changes, onReady } = await setup()
    await manager.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    manager.cancel()
    expect(manager.status().state).toBe('idle')
    await manager.start()
    await manager.whenIdle()
    expect(manager.status()).toMatchObject({ state: 'idle', downloadedBytes: 5_060_000 })
    expect(changes.at(-1)).toMatchObject({ state: 'idle', downloadedBytes: 5_060_000 })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(readdirSync(join(dir, 'models'))).toEqual(['test-model'])
  })

  it('AC-25: a cancel leaves nothing behind', async () => {
    const { manager, dir } = await setup()
    await manager.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    manager.cancel()
    await manager.whenIdle()
    expect(readdirSync(join(dir, 'models')).filter((name) => name.endsWith('.part'))).toEqual([])
    expect(manager.status().state).toBe('idle')
  })

  it('AC-22: the state is downloading as soon as start is called, before anything is awaited', async () => {
    const { manager } = await setup()
    const starting = manager.start()
    expect(manager.status().state).toBe('downloading')
    await starting
    await manager.whenIdle()
  })
})
