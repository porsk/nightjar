declare module 'sherpa-onnx-node' {
  interface OfflineStream {
    setOption(key: string, value: string): void
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void
  }

  interface OfflineRecognizer {
    setConfig(config: object): void
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): { text: string; lang?: string }
  }

  interface Vad {
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(): { samples: Float32Array }
    pop(): void
    flush(): void
  }

  const sherpa: {
    OfflineRecognizer: new (config: object) => OfflineRecognizer
    Vad: new (config: object, bufferSizeInSeconds: number) => Vad
    readWave: (path: string) => { samples: Float32Array; sampleRate: number }
  }
  export default sherpa
}
