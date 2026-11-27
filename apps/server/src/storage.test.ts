import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStorage, recordingKey } from './storage.ts'

describe('003-voice-entries: storage of recordings', () => {
  it('AC-10: builds the key under the user folder from ids only', () => {
    expect(recordingKey('user-1', 'rec-1', 'm4a')).toBe('media/user-1/recordings/rec-1.m4a')
  })

  it('AC-10: moves a temp file to its key, reads ranges and tells the size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-storage-'))
    const storage = createStorage(dir)
    const temp = await storage.tempFile('upload')
    await writeFile(temp.path, '0123456789')

    await storage.adopt(temp.path, 'media/u1/recordings/r1.wav')

    expect(existsSync(temp.path)).toBe(false)
    expect(await storage.size('media/u1/recordings/r1.wav')).toBe(10)
    expect(await storage.size('media/u1/recordings/missing.wav')).toBeUndefined()
    const chunks: Buffer[] = []
    for await (const chunk of storage.read('media/u1/recordings/r1.wav', { start: 2, end: 4 })) {
      chunks.push(chunk as Buffer)
    }
    expect(Buffer.concat(chunks).toString()).toBe('234')
  })

  it('AC-11: a temp file can be removed, also twice', async () => {
    const storage = createStorage(await mkdtemp(join(tmpdir(), 'nightjar-storage-')))
    const temp = await storage.tempFile('wav')
    await writeFile(temp.path, 'x')
    await temp.remove()
    await temp.remove()
    expect(existsSync(temp.path)).toBe(false)
  })

  it('AC-21: makes folders for keys and hands out local paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-storage-'))
    const storage = createStorage(dir)
    await storage.makeFolder('models/m1')
    expect(existsSync(join(dir, 'models/m1'))).toBe(true)
    expect(storage.localPath('models/m1')).toBe(join(dir, 'models/m1'))
  })
})

describe('002-text-entries: storage', () => {
  it('AC-9: removes the file behind a key and does not mind a missing one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-storage-'))
    await mkdir(join(dir, 'media/u1'), { recursive: true })
    await writeFile(join(dir, 'media/u1/a.webm'), 'audio')
    const storage = createStorage(dir)

    await storage.remove('media/u1/a.webm')
    expect(existsSync(join(dir, 'media/u1/a.webm'))).toBe(false)
    await expect(storage.remove('media/u1/a.webm')).resolves.toBeUndefined()
  })

  it('AC-9: refuses keys that point outside the data folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-storage-'))
    const outside = join(dir, '..', 'nightjar-outside.txt')
    await writeFile(outside, 'keep')
    const storage = createStorage(dir)

    await expect(storage.remove('../nightjar-outside.txt')).rejects.toThrow()
    await expect(storage.remove('/etc/passwd')).rejects.toThrow()
    expect(existsSync(outside)).toBe(true)
  })
})
