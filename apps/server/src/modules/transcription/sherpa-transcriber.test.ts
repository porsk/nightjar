import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { defaultModel, supportedModels } from './models.ts'
import { createSherpaTranscriber, type WorkerLike } from './sherpa-transcriber.ts'
import type { SherpaReply, SherpaRequest } from './sherpa-worker.ts'

class StubWorker extends EventEmitter implements WorkerLike {
  requests: SherpaRequest[] = []
  terminated = false
  postMessage(request: SherpaRequest) {
    this.requests.push(request)
  }
  terminate() {
    this.terminated = true
    return Promise.resolve(0)
  }
  reply(reply: SherpaReply) {
    this.emit('message', reply)
  }
}

const make = () => {
  const worker = new StubWorker()
  const transcriber = createSherpaTranscriber(
    defaultModel(supportedModels),
    '/models/x',
    () => worker,
  )
  return { worker, transcriber }
}

describe('003-voice-entries: sherpa transcriber', () => {
  it('AC-15: asks the thread for the given language and returns the asked one', async () => {
    const { worker, transcriber } = make()
    const result = transcriber.transcribe('/tmp/a.wav', 'hu')
    worker.reply({ id: 1, ok: true, text: 'szia', detected: '<|en|>' })
    expect(await result).toEqual({ text: 'szia', language: 'hu' })
    expect(worker.requests[0]).toMatchObject({ wavPath: '/tmp/a.wav', language: 'hu' })
  })

  it('AC-15: with auto the detected language is stored, and anything but hu counts as en', async () => {
    const { worker, transcriber } = make()
    const hungarian = transcriber.transcribe('/tmp/a.wav', 'auto')
    worker.reply({ id: 1, ok: true, text: 'szia', detected: '<|hu|>' })
    expect((await hungarian).language).toBe('hu')
    const german = transcriber.transcribe('/tmp/b.wav', 'auto')
    worker.reply({ id: 2, ok: true, text: 'hallo', detected: 'de' })
    expect((await german).language).toBe('en')
  })

  it('AC-16: a failed decode rejects the call', async () => {
    const { worker, transcriber } = make()
    const result = transcriber.transcribe('/tmp/a.wav', 'en')
    worker.reply({ id: 1, ok: false })
    await expect(result).rejects.toThrow('could not transcribe')
  })

  it('AC-16: when the thread dies, the waiting call and every later call fail at once', async () => {
    const { worker, transcriber } = make()
    const waiting = transcriber.transcribe('/tmp/a.wav', 'en')
    worker.emit('exit')
    await expect(waiting).rejects.toThrow('stopped')
    await expect(transcriber.transcribe('/tmp/b.wav', 'en')).rejects.toThrow('stopped')
    expect(worker.requests).toHaveLength(1)
  })

  it('AC-16: an error in the thread fails waiting calls too', async () => {
    const { worker, transcriber } = make()
    const waiting = transcriber.transcribe('/tmp/a.wav', 'en')
    worker.emit('error', new Error('crash'))
    await expect(waiting).rejects.toThrow('crash')
  })

  it('AC-14: disposing ends the thread and waits for it', async () => {
    const { worker, transcriber } = make()
    await transcriber.dispose()
    expect(worker.terminated).toBe(true)
    await expect(transcriber.transcribe('/tmp/a.wav', 'en')).rejects.toThrow()
  })
})
