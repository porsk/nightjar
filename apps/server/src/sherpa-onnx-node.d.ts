declare module 'sherpa-onnx-node' {
  interface OfflineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
  }

  class OfflineRecognizer {
    constructor(config: object)
    setConfig(config: object): void
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): { text: string; lang?: string }
  }

  class Vad {
    constructor(config: object, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(): { samples: Float32Array }
    pop(): void
    flush(): void
  }

  function readWave(path: string): { samples: Float32Array; sampleRate: number }

  const sherpa: {
    OfflineRecognizer: typeof OfflineRecognizer
    Vad: typeof Vad
    readWave: typeof readWave
  }
  export default sherpa
}
