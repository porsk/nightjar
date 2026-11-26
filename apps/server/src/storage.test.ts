import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStorage } from './storage.ts'

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
