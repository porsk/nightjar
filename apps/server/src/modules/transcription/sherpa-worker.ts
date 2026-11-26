import { parentPort, workerData } from 'node:worker_threads'
import sherpa from 'sherpa-onnx-node'

export interface SherpaWorkerData {
  encoder: string
  decoder: string
  tokens: string
  vad: string
  threads: number
}

export type SherpaRequest = { id: number; wavPath: string; language: 'hu' | 'en' | 'auto' }
export type SherpaReply =
  { id: number; ok: true; text: string; detected: string } | { id: number; ok: false }

const sampleRate = 16000
const longestWholeClipSeconds = 25
const files = workerData as SherpaWorkerData

const recognizerConfig = (language: SherpaRequest['language']) => ({
  featConfig: { sampleRate, featureDim: 128 },
  modelConfig: {
    whisper: {
      encoder: files.encoder,
      decoder: files.decoder,
      language: language === 'auto' ? '' : language,
      task: 'transcribe',
    },
    tokens: files.tokens,
    numThreads: files.threads,
    provider: 'cpu',
  },
})

let recognizer: InstanceType<typeof sherpa.OfflineRecognizer> | undefined
let loadedLanguage: SherpaRequest['language'] | undefined

function recognizerFor(language: SherpaRequest['language']) {
  if (!recognizer) {
    recognizer = new sherpa.OfflineRecognizer(recognizerConfig(language))
  } else if (loadedLanguage !== language) {
    recognizer.setConfig(recognizerConfig(language))
  }
  loadedLanguage = language
  return recognizer
}

function decode(samples: Float32Array, language: SherpaRequest['language']) {
  const engine = recognizerFor(language)
  const stream = engine.createStream()
  stream.acceptWaveform({ sampleRate, samples })
  engine.decode(stream)
  const result = engine.getResult(stream) as { text: string; lang?: string }
  return { text: result.text.trim(), detected: result.lang ?? '' }
}

function speechSegments(samples: Float32Array): Float32Array[] {
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: files.vad,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 20,
        windowSize: 512,
      },
      sampleRate,
      numThreads: 1,
    },
    60,
  )
  const segments: Float32Array[] = []
  const drain = () => {
    while (!vad.isEmpty()) {
      segments.push(vad.front().samples)
      vad.pop()
    }
  }
  for (let start = 0; start < samples.length; start += 512) {
    vad.acceptWaveform(samples.subarray(start, start + 512))
    drain()
  }
  vad.flush()
  drain()
  return segments
}

function transcribe({ wavPath, language }: SherpaRequest) {
  const { samples } = sherpa.readWave(wavPath)
  if (samples.length / sampleRate <= longestWholeClipSeconds) return decode(samples, language)
  const parts = speechSegments(samples).map((segment) => decode(segment, language))
  return {
    text: parts.map((part) => part.text).join(' '),
    detected: parts.find((part) => part.detected !== '')?.detected ?? '',
  }
}

parentPort?.on('message', (request: SherpaRequest) => {
  try {
    const { text, detected } = transcribe(request)
    parentPort?.postMessage({ id: request.id, ok: true, text, detected } satisfies SherpaReply)
  } catch {
    parentPort?.postMessage({ id: request.id, ok: false } satisfies SherpaReply)
  }
})
