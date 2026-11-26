import path from 'node:path'
import type { Page } from '@playwright/test'

const fixtures = path.join(import.meta.dirname, '..', 'fixtures')

export function fakeMic(wavFile: string) {
  return {
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${path.join(fixtures, wavFile)}`,
      ],
    },
  }
}

export async function peakLevelFromMic(page: Page) {
  return page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
    })
    const [track] = stream.getAudioTracks()
    if (track?.readyState !== 'live') return { live: false, peak: 0 }

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let peak = 0
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      analyser.getFloatTimeDomainData(samples)
      peak = Math.max(peak, ...samples.map(Math.abs))
    }
    return { live: true, peak }
  })
}
