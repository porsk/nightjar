import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStorage } from '../../storage.ts'
import {
  defaultModel,
  downloadBytes,
  isModelReady,
  modelById,
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

describe('009-transcription-models: model list', () => {
  it('AC-1: turbo is the default and first, and large-v3 has exactly the values of the spec', () => {
    expect(modelListSchema.safeParse(supportedModels).success).toBe(true)
    expect(supportedModels.default).toBe('whisper-large-v3-turbo-int8')
    expect(supportedModels.models.map((model) => model.id)).toEqual([
      'whisper-large-v3-turbo-int8',
      'whisper-large-v3-int8',
      'whisper-large-v3-turbo-fp32',
    ])
    const large = modelById(supportedModels, 'whisper-large-v3-int8')
    const release = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
    expect(large.downloads).toEqual([
      {
        url: `${release}/sherpa-onnx-whisper-large-v3.tar.bz2`,
        sha256: '2d0e134b3b5fc4a0533baf24a0c9d473b629aa47f030af0a165a05f461df7a03',
        bytes: 1068482488,
        archive: true,
      },
      {
        url: `${release}/silero_vad.onnx`,
        sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        bytes: 643854,
        archive: false,
      },
    ])
    expect(large.files).toEqual([
      { name: 'large-v3-encoder.int8.onnx', bytes: 766671985 },
      { name: 'large-v3-decoder.int8.onnx', bytes: 1008265203 },
      { name: 'large-v3-tokens.txt', bytes: 816730 },
      { name: 'silero_vad.onnx', bytes: 643854 },
    ])
  })

  it('AC-1: the full precision turbo model has its encoder weights next to the encoder', () => {
    const fp32 = modelById(supportedModels, 'whisper-large-v3-turbo-fp32')
    const hub = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main'
    expect(fp32.downloads.map((item) => [item.url, item.sha256, item.bytes, item.archive])).toEqual(
      [
        [
          `${hub}/turbo-encoder.onnx`,
          '1b960f278564fb8bbacd544d4f85f4dd6d8a64d3aa89543d8f2c4021c926f976',
          735920,
          false,
        ],
        [
          `${hub}/turbo-encoder.weights`,
          '746f879ecf066450ab0cdecc05383380b85157270ff6c0a9fb7cfdd917036e12',
          2600325120,
          false,
        ],
        [
          `${hub}/turbo-decoder.onnx`,
          'b24db5d90fa230c5eaa6b823d74862ced9e0d1dc3e01ec46601968e8db0e09ec',
          636209532,
          false,
        ],
        [
          `${hub}/turbo-tokens.txt`,
          'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
          816730,
          false,
        ],
        [
          'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
          '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
          643854,
          false,
        ],
      ],
    )
    expect(fp32.files.map((file) => file.name)).toEqual([
      'turbo-encoder.onnx',
      'turbo-encoder.weights',
      'turbo-decoder.onnx',
      'turbo-tokens.txt',
      'silero_vad.onnx',
    ])
  })

  it('AC-1: an id that is no longer in the list falls back to the default model', () => {
    expect(modelById(supportedModels, 'dropped-model').id).toBe(supportedModels.default)
  })
})
