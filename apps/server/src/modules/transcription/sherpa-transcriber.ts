import { availableParallelism } from 'node:os'
import { fork } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Language } from '@nightjar/shared'
import type { ModelInfo } from './models.ts'
import type { SherpaReply, SherpaRequest, SherpaChildData } from './sherpa-child.ts'
import type { Transcriber } from './transcriber.ts'

const maxThreads = 4

/** The part of a child process this module uses, so tests can stand in for it. */
export interface ChildLike {
  on(event: 'message', listener: (reply: SherpaReply) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: () => void): unknown
  postMessage(request: SherpaRequest): void
  terminate(): Promise<unknown>
}

const startChild = (data: SherpaChildData): ChildLike => {
  const child = fork(fileURLToPath(new URL('./sherpa-child.ts', import.meta.url)), [
    JSON.stringify(data),
  ])
  return {
    on: ((event: string, listener: () => void) => {
      child.on(event, listener)
    }) as ChildLike['on'],
    postMessage: (request) => {
      child.send(request)
    },
    terminate: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(undefined)
          return
        }
        child.once('exit', () => {
          resolve(undefined)
        })
        child.kill('SIGKILL')
      }),
  }
}

const fileNamed = (model: ModelInfo, part: string) => {
  const file = model.files.find((candidate) => candidate.name.includes(part))
  if (!file) throw new Error(`the model has no ${part} file`)
  return file.name
}

const spokenLanguage = (detected: string): Language => {
  const code = detected.replaceAll(/[<|>]/g, '')
  return code === 'hu' ? 'hu' : 'en'
}

/**
 * Runs sherpa-onnx in a child process, so decoding never blocks requests and the OS takes back all
 * model memory when the process ends. Disposing ends the process. When it dies on its own, waiting and
 * later calls fail at once.
 */
export function createSherpaTranscriber(
  model: ModelInfo,
  modelFolder: string,
  createChild: (data: SherpaChildData) => ChildLike = startChild,
): Transcriber {
  const child = createChild({
    encoder: join(modelFolder, fileNamed(model, 'encoder')),
    decoder: join(modelFolder, fileNamed(model, 'decoder')),
    tokens: join(modelFolder, fileNamed(model, 'tokens')),
    vad: join(modelFolder, fileNamed(model, 'vad')),
    threads: Math.min(maxThreads, availableParallelism()),
  })
  const pending = new Map<
    number,
    { resolve: (reply: SherpaReply) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  let dead = false

  const markDead = (error: Error) => {
    dead = true
    for (const waiting of pending.values()) waiting.reject(error)
    pending.clear()
  }
  child.on('message', (reply) => {
    pending.get(reply.id)?.resolve(reply)
    pending.delete(reply.id)
  })
  child.on('error', markDead)
  child.on('exit', () => {
    markDead(new Error('the transcription process stopped'))
  })

  return {
    modelId: model.id,
    transcribe: async (wavPath, language) => {
      if (dead) throw new Error('the transcription process stopped')
      const id = nextId++
      const reply = await new Promise<SherpaReply>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.postMessage({ id, wavPath, language })
      })
      if (!reply.ok) throw new Error('the model could not transcribe the audio')
      return {
        text: reply.text,
        language: language === 'auto' ? spokenLanguage(reply.detected) : language,
      }
    },
    dispose: async () => {
      dead = true
      await child.terminate()
    },
  }
}
