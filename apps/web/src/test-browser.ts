import { vi } from 'vitest'

/** Browser APIs that jsdom does not have, as small fakes the tests can steer. */

export class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  static instances: FakeMediaRecorder[] = []
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = 'recording'
  }

  pause() {
    this.state = 'paused'
  }

  resume() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

class FakeAnalyser {
  fftSize = 1024
  level = 0
  getByteTimeDomainData(samples: Uint8Array) {
    samples.fill(128 + this.level)
  }
}

export const microphone = { level: 0, analysers: [] as FakeAnalyser[] }

class FakeAudioContext {
  createAnalyser() {
    const analyser = new FakeAnalyser()
    microphone.analysers.push(analyser)
    return analyser
  }

  createMediaStreamSource() {
    return { connect: vi.fn() }
  }

  close() {
    return Promise.resolve()
  }
}

export function installRecorderFakes(options: { error?: string } = {}) {
  FakeMediaRecorder.instances = []
  microphone.analysers = []
  const track = { stop: vi.fn() }
  const getUserMedia = vi.fn(() =>
    options.error
      ? Promise.reject(new DOMException('no microphone', options.error))
      : Promise.resolve({ getTracks: () => [track] }),
  )
  const release = vi.fn(() => Promise.resolve())
  const request = vi.fn(() => Promise.resolve({ release }))
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return { getUserMedia, track, wakeLock: { request, release } }
}

export class FakeXhr {
  static instances: FakeXhr[] = []
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null
  } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  responseText = ''
  method = ''
  url = ''
  body: FormData | undefined
  aborted = false

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: FormData) {
    this.body = body
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
}

export function installXhrFake() {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return FakeXhr
}

export const recording = (overrides: object = {}) => ({
  id: 'r1',
  entryId: 'e1',
  status: 'done',
  durationMs: 108_000,
  mimeType: 'audio/webm',
  language: 'hu',
  failure: null,
  createdAt: '2026-11-26T19:42:00.000Z',
  transcript: {
    text: 'Ma reggel korán keltem.',
    language: 'hu',
    model: 'fake',
    isUserEdited: false,
    updatedAt: '2026-11-26T19:43:00.000Z',
  },
  ...overrides,
})

export const entryBody = {
  id: 'e1',
  entryDate: '2026-11-26',
  bodyMd: '',
  createdAt: '2026-11-26T19:42:00.000Z',
  updatedAt: '2026-11-26T19:42:00.000Z',
}

/** The two cloud providers as the status lists them, with no key saved. */
export const providerRows = (overrides: Record<string, object> = {}) => [
  {
    id: 'soniox',
    label: 'Soniox',
    configured: false,
    keyError: null,
    pricePerHour: { amount: 0.1, currency: 'USD' },
    ...overrides.soniox,
  },
  {
    id: 'gladia',
    label: 'Gladia',
    configured: false,
    keyError: null,
    pricePerHour: { amount: 0.27, currency: 'EUR' },
    ...overrides.gladia,
  },
]

export const usageRows = (overrides: Record<string, object> = {}) => [
  { engine: 'soniox', audioMs: 0, estimatedCost: 0, ...overrides.soniox },
  { engine: 'gladia', audioMs: 0, estimatedCost: 0, ...overrides.gladia },
]
