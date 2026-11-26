import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Language } from '@nightjar/shared'
import type { ModelInfo } from './models.ts'
import type { SherpaReply, SherpaRequest, SherpaWorkerData } from './sherpa-worker.ts'
import type { Transcriber } from './transcriber.ts'

const maxThreads = 4

const fileNamed = (model: ModelInfo, part: string) => {
  const file = model.files.find((candidate) => candidate.name.includes(part))
  if (!file) throw new Error(`the model has no ${part} file`)
  return file.name
}

const spokenLanguage = (detected: string): Language => {
  const code = detected.replaceAll(/[<|>]/g, '')
  return code === 'hu' ? 'hu' : 'en'
}

/** Runs sherpa-onnx in a worker thread, so decoding never blocks requests. Disposing ends the thread and frees the model. */
export function createSherpaTranscriber(model: ModelInfo, modelFolder: string): Transcriber {
  const data: SherpaWorkerData = {
    encoder: join(modelFolder, fileNamed(model, 'encoder')),
    decoder: join(modelFolder, fileNamed(model, 'decoder')),
    tokens: join(modelFolder, fileNamed(model, 'tokens')),
    vad: join(modelFolder, fileNamed(model, 'vad')),
    threads: Math.min(maxThreads, availableParallelism()),
  }
  const worker = new Worker(new URL('./sherpa-worker.ts', import.meta.url), { workerData: data })
  const pending = new Map<
    number,
    { resolve: (reply: SherpaReply) => void; reject: (error: Error) => void }
  >()
  let nextId = 1

  const failAll = (error: Error) => {
    for (const waiting of pending.values()) waiting.reject(error)
    pending.clear()
  }
  worker.on('message', (reply: SherpaReply) => {
    pending.get(reply.id)?.resolve(reply)
    pending.delete(reply.id)
  })
  worker.on('error', failAll)
  worker.on('exit', () => {
    failAll(new Error('the transcription thread stopped'))
  })

  return {
    modelId: model.id,
    transcribe: async (wavPath, language) => {
      const id = nextId++
      const reply = await new Promise<SherpaReply>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, wavPath, language } satisfies SherpaRequest)
      })
      if (!reply.ok) throw new Error('the model could not transcribe the audio')
      return {
        text: reply.text,
        language: language === 'auto' ? spokenLanguage(reply.detected) : language,
      }
    },
    dispose: () => {
      void worker.terminate()
    },
  }
}
