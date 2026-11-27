import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { convertToWav } from '../../src/audio/ffmpeg.ts'
import { createLogger } from '../../src/logger.ts'
import { createModelManager } from '../../src/modules/transcription/model-manager.ts'
import {
  defaultModel,
  isModelReady,
  supportedModels,
} from '../../src/modules/transcription/models.ts'
import { createSherpaTranscriber } from '../../src/modules/transcription/sherpa-transcriber.ts'
import type { Transcriber } from '../../src/modules/transcription/transcriber.ts'
import { createStorage, modelKey } from '../../src/storage.ts'
import { wordErrorRate } from '../support/wer.ts'

const fixtures = join(import.meta.dirname, '../../../../e2e/fixtures')
const references = {
  hu: 'Chandra Shekhar Solanki rendőrfelügyelő szerint a vádlottak fedett arccal jelentek meg a bíróságon.',
  en: 'Swirl the two dry powders together and then, with clean wet hands, squeeze them into a ball.',
} as const

const maxWordErrorRate = 0.3

describe.skipIf(process.env['NIGHTJAR_TRANSCRIBER'] !== 'sherpa')(
  '003-voice-entries: the real model',
  () => {
    let transcriber: Transcriber
    let folder: string

    beforeAll(async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'nightjar-real-model-'))
      const storage = createStorage(dataDir)
      const model = defaultModel(supportedModels)
      const manager = createModelManager({
        storage,
        model,
        logger: createLogger({ level: 'info' }),
        onChange: () => undefined,
        onReady: () => undefined,
      })
      await manager.start()
      await manager.whenIdle()
      expect(await isModelReady(storage, model)).toBe(true)
      transcriber = createSherpaTranscriber(model, storage.localPath(modelKey(model.id)))
      folder = await mkdtemp(join(tmpdir(), 'nightjar-real-wav-'))
    }, 1_800_000)

    afterAll(async () => {
      await transcriber.dispose()
    })

    for (const language of ['hu', 'en'] as const) {
      it(`AC-29: ${language}-sample.wav is transcribed with a word error rate under 30%`, async () => {
        const wav = join(folder, `${language}.wav`)
        await convertToWav(join(fixtures, `${language}-sample.wav`), wav, 'wav')
        const result = await transcriber.transcribe(wav, language)
        const rate = wordErrorRate(references[language], result.text)
        console.info(`${language}: WER ${(rate * 100).toFixed(1)}%`)
        expect(rate).toBeLessThan(maxWordErrorRate)
      }, 300_000)
    }

    it('AC-29: auto detects the language of both clips', async () => {
      for (const language of ['hu', 'en'] as const) {
        const wav = join(folder, `${language}.wav`)
        const result = await transcriber.transcribe(wav, 'auto')
        expect(result.language).toBe(language)
      }
    }, 300_000)
  },
)
