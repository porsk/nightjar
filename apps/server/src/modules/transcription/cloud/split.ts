import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { copyAudio, detectSilences, type Silence } from '../../../audio/ffmpeg.ts'
import { ffmpegFormatFor } from '../../../audio/sniff.ts'
import type { AudioExtension } from './provider.ts'

/** The ffmpeg muxer for each container we can write. */
const muxers: Record<AudioExtension, string> = {
  webm: 'webm',
  ogg: 'ogg',
  m4a: 'mp4',
  aac: 'adts',
  mp3: 'mp3',
  wav: 'wav',
  flac: 'flac',
}

/** Parts are cut for 90% of the limit, so the search window around a cut still leaves them under it. */
const targetShare = 0.9

/** Cut times in seconds, one fewer than the parts. Empty when the recording fits in one part. */
export function planCuts(
  durationMs: number,
  maxAudioMs: number,
  silences: readonly Silence[],
): number[] {
  if (durationMs <= maxAudioMs) return []
  const parts = Math.ceil(durationMs / (targetShare * maxAudioMs))
  const reach = Math.min(60, 0.05 * (maxAudioMs / 1000))
  const cuts: number[] = []
  for (let index = 1; index < parts; index++) {
    const target = (index * durationMs) / parts / 1000
    let best = target
    let bestDistance = Number.POSITIVE_INFINITY
    for (const silence of silences) {
      const middle = (silence.startSeconds + Math.min(silence.endSeconds, durationMs / 1000)) / 2
      const distance = Math.abs(middle - target)
      if (distance <= reach && distance < bestDistance) {
        best = middle
        bestDistance = distance
      }
    }
    cuts.push(best)
  }
  return cuts
}

export interface AudioPart {
  path: string
  durationMs: number
}

/**
 * Copies the recording into `folder` as one part, or several when it is longer than the limit,
 * in the container the provider accepts. Stream copy only.
 */
export async function makeParts(options: {
  input: string
  stored: AudioExtension
  container: AudioExtension
  durationMs: number
  maxAudioMs: number | null
  folder: string
}): Promise<AudioPart[]> {
  const { input, stored, container, durationMs, maxAudioMs, folder } = options
  const format = ffmpegFormatFor(stored) ?? ''
  const cuts =
    maxAudioMs === null || durationMs <= maxAudioMs
      ? []
      : planCuts(durationMs, maxAudioMs, await detectSilences(input, format))
  if (cuts.length === 0 && container === stored) {
    return [{ path: input, durationMs }]
  }
  await copyAudio({
    input,
    format,
    container: muxers[container],
    cuts,
    pattern: join(folder, `part-%03d.${container}`),
  })
  const names = (await readdir(folder)).filter((name) => name.endsWith(`.${container}`)).sort()
  const edges = [0, ...cuts.map((cut) => cut * 1000), durationMs]
  return names.map((name, index) => ({
    path: join(folder, name),
    durationMs: Math.max(0, (edges[index + 1] ?? durationMs) - (edges[index] ?? 0)),
  }))
}
