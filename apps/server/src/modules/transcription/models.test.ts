import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStorage } from '../../storage.ts'
import {
  defaultModel,
  downloadBytes,
  isModelReady,
  modelListSchema,
  supportedModels,
} from './models.ts'

describe('003-voice-entries: model list', () => {
  it('AC-21: the list in the repo is valid and its default is Whisper large-v3-turbo int8', () => {
    expect(modelListSchema.safeParse(supportedModels).success).toBe(true)
    const model = defaultModel(supportedModels)
    expect(model.id).toBe('whisper-large-v3-turbo-int8')
    for (const item of model.downloads) {
      expect(item.url).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\//)
    }
    expect(downloadBytes(model)).toBeGreaterThan(500_000_000)
  })

  it('AC-21: a default that is not in the list is an error', () => {
    expect(() => defaultModel({ ...supportedModels, default: 'missing' })).toThrow()
  })

  it('AC-22: the model is ready only when every file has its expected size', async () => {
    const model = {
      id: 'small',
      label: 'Small',
      downloads: [
        { url: 'https://example.test/a', sha256: 'a'.repeat(64), bytes: 5, archive: false },
      ],
      files: [{ name: 'a.bin', bytes: 5 }],
    }
    const dir = await mkdtemp(join(tmpdir(), 'nightjar-models-'))
    const storage = createStorage(dir)
    expect(await isModelReady(storage, model)).toBe(false)
    await mkdir(join(dir, 'models/small'), { recursive: true })
    await writeFile(join(dir, 'models/small/a.bin'), 'abc')
    expect(await isModelReady(storage, model)).toBe(false)
    await writeFile(join(dir, 'models/small/a.bin'), 'abcde')
    expect(await isModelReady(storage, model)).toBe(true)
  })
})
