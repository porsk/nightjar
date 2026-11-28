import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixtures = join(import.meta.dirname, '../../../../e2e/fixtures')
const huWav = readFileSync(join(fixtures, 'hu-sample.wav'))
const enWav = readFileSync(join(fixtures, 'en-sample.wav'))

const cache = new Map<string, Buffer>()

const withTemp = <T>(work: (folder: string) => T): T => {
  const folder = mkdtempSync(join(tmpdir(), 'nightjar-audio-'))
  try {
    return work(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

const ffmpeg = (args: string[]) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-nostdin', ...args], { stdio: 'ignore' })
}

/** The English or Hungarian sample as webm/opus, m4a/aac or ogg/opus. */
export function sampleAs(kind: 'webm' | 'm4a' | 'ogg', language: 'hu' | 'en' = 'hu'): Buffer {
  const key = `${kind}-${language}`
  const cached = cache.get(key)
  if (cached) return cached
  const made = withTemp((folder) => {
    const input = join(folder, 'in.wav')
    const output = join(folder, `out.${kind}`)
    writeFileSync(input, language === 'hu' ? huWav : enWav)
    ffmpeg(['-i', input, '-c:a', kind === 'm4a' ? 'aac' : 'libopus', output])
    return readFileSync(output)
  })
  cache.set(key, made)
  return made
}

export const pauseCenters = [49, 101]

/** 150 s of tone with silences of one second centred at 49 s and 101 s, as ogg/opus. */
export function pausesOgg(): Buffer {
  const cached = cache.get('pauses')
  if (cached) return cached
  const made = withTemp((folder) => {
    const output = join(folder, 'pauses.ogg')
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=150:sample_rate=48000',
      '-af',
      "volume=enable='between(t,48.5,49.5)+between(t,100.5,101.5)':volume=0",
      '-c:a',
      'libopus',
      output,
    ])
    return readFileSync(output)
  })
  cache.set('pauses', made)
  return made
}

/** Codec and length of an audio file, read with ffprobe. */
export function probe(data: Buffer, extension: string): { codec: string; seconds: number } {
  return withTemp((folder) => {
    const path = join(folder, `probe.${extension}`)
    writeFileSync(path, data)
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name:format=duration',
        '-of',
        'json',
        '-i',
        path,
      ],
      { encoding: 'utf8' },
    )
    const parsed = JSON.parse(out) as {
      streams: { codec_name: string }[]
      format: { duration: string }
    }
    return { codec: parsed.streams[0]?.codec_name ?? '', seconds: Number(parsed.format.duration) }
  })
}
