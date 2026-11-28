import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { defaultModel, supportedModels } from './models.ts'
import { createSherpaTranscriber, type ChildLike } from './sherpa-transcriber.ts'
import type { SherpaReply, SherpaRequest } from './sherpa-child.ts'

class StubChild extends EventEmitter implements ChildLike {
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
  const child = new StubChild()
  const transcriber = createSherpaTranscriber(
    defaultModel(supportedModels),
    '/models/x',
    () => child,
  )
  return { child, transcriber }
}

const signal = new AbortController().signal
const audio = (path: string) => ({
  path,
  extension: 'wav' as const,
  durationMs: 0,
  recordingId: 'r',
  userId: 'u',
})

describe('003-voice-entries: sherpa transcriber', () => {
  it('AC-15: asks the process for the given language and returns the asked one', async () => {
    const { child, transcriber } = make()
    const result = transcriber.transcribe(audio('/tmp/a.wav'), 'hu', signal)
    child.reply({ id: 1, ok: true, text: 'szia', detected: '<|en|>' })
    expect(await result).toEqual({ text: 'szia', language: 'hu' })
    expect(child.requests[0]).toMatchObject({ wavPath: '/tmp/a.wav', language: 'hu' })
  })

  it('AC-15: with auto the detected language is stored, and anything but hu counts as en', async () => {
    const { child, transcriber } = make()
    const hungarian = transcriber.transcribe(audio('/tmp/a.wav'), 'auto', signal)
    child.reply({ id: 1, ok: true, text: 'szia', detected: '<|hu|>' })
    expect((await hungarian).language).toBe('hu')
    const german = transcriber.transcribe(audio('/tmp/b.wav'), 'auto', signal)
    child.reply({ id: 2, ok: true, text: 'hallo', detected: 'de' })
    expect((await german).language).toBe('en')
  })

  it('AC-16: a failed decode rejects the call', async () => {
    const { child, transcriber } = make()
    const result = transcriber.transcribe(audio('/tmp/a.wav'), 'en', signal)
    child.reply({ id: 1, ok: false })
    await expect(result).rejects.toThrow('could not transcribe')
  })

  it('AC-16: when the process dies, the waiting call and every later call fail at once', async () => {
    const { child, transcriber } = make()
    const waiting = transcriber.transcribe(audio('/tmp/a.wav'), 'en', signal)
    child.emit('exit')
    await expect(waiting).rejects.toThrow('stopped')
    await expect(transcriber.transcribe(audio('/tmp/b.wav'), 'en', signal)).rejects.toThrow(
      'stopped',
    )
    expect(child.requests).toHaveLength(1)
  })

  it('AC-16: an error in the process fails waiting calls too', async () => {
    const { child, transcriber } = make()
    const waiting = transcriber.transcribe(audio('/tmp/a.wav'), 'en', signal)
    child.emit('error', new Error('crash'))
    await expect(waiting).rejects.toThrow('crash')
  })

  it('AC-14: disposing ends the process and waits for it', async () => {
    const { child, transcriber } = make()
    await transcriber.dispose()
    expect(child.terminated).toBe(true)
    await expect(transcriber.transcribe(audio('/tmp/a.wav'), 'en', signal)).rejects.toThrow()
  })

  it('AC-14: the real child process answers over IPC and ends when the transcriber is disposed', async () => {
    const transcriber = createSherpaTranscriber(defaultModel(supportedModels), '/no/such/models')
    await expect(transcriber.transcribe(audio('/no/such/file.wav'), 'en', signal)).rejects.toThrow()
    await transcriber.dispose()
    await transcriber.dispose()
  }, 30_000)
})
