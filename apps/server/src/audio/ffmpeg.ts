import { spawn } from 'node:child_process'

/** ffmpeg could not read the file as audio. */
export class UnreadableAudioError extends Error {}

/** Input options that keep ffmpeg to the one local file in the given format. */
const inputOptions = (format: string, path: string) => [
  '-protocol_whitelist',
  'file',
  '-f',
  format,
  '-i',
  path,
]

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new UnreadableAudioError(`ffmpeg exited with ${String(code)}`))
    })
  })
}

/** Decodes the whole file to find its length, because recorded webm files carry no duration in their header. */
export async function measureDurationMs(path: string, format: string): Promise<number> {
  const output = await runFfmpeg([
    ...inputOptions(format, path),
    '-vn',
    '-f',
    'null',
    '-progress',
    'pipe:1',
    '-nostats',
    '-',
  ])
  const microseconds = [...output.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1]
  if (microseconds === undefined) throw new UnreadableAudioError('no audio found')
  return Math.round(Number(microseconds) / 1000)
}

/** Writes a 16 kHz mono 16-bit WAV, the input format of the speech model. */
export async function convertToWav(input: string, output: string, format: string): Promise<void> {
  await runFfmpeg([
    '-y',
    ...inputOptions(format, input),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    output,
  ])
}

/** Runs ffmpeg and returns what it wrote to stderr, where filters like silencedetect report. */
function runFfmpegForLog(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'info', '-nostats', '-nostdin', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new UnreadableAudioError(`ffmpeg exited with ${String(code)}`))
    })
  })
}

export interface Silence {
  startSeconds: number
  endSeconds: number
}

/** Finds the pauses in a file: at least 0.4 s quieter than -35 dB. */
export async function detectSilences(path: string, format: string): Promise<Silence[]> {
  const log = await runFfmpegForLog([
    ...inputOptions(format, path),
    '-vn',
    '-af',
    'silencedetect=noise=-35dB:d=0.4',
    '-f',
    'null',
    '-',
  ])
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((match) => Number(match[1]))
  const ends = [...log.matchAll(/silence_end: (-?[\d.]+)/g)].map((match) => Number(match[1]))
  return starts.map((start, index) => ({
    startSeconds: Math.max(0, start),
    endSeconds: ends[index] ?? Number.POSITIVE_INFINITY,
  }))
}

/**
 * Stream copy into `container`, cut at the given times (seconds) into numbered files. No re-encode.
 * `pattern` holds `%03d`, like `/tmp/x/part-%03d.ogg`. Without cuts the output is one file at `pattern`
 * with `%03d` replaced by `000`.
 */
export async function copyAudio(options: {
  input: string
  format: string
  container: string
  cuts: number[]
  pattern: string
}): Promise<void> {
  const { input, format, container, cuts, pattern } = options
  const segmenting =
    cuts.length === 0
      ? ['-f', container, pattern.replace('%03d', '000')]
      : [
          '-f',
          'segment',
          '-segment_times',
          cuts.map((cut) => cut.toFixed(3)).join(','),
          '-reset_timestamps',
          '1',
          '-segment_format',
          container,
          pattern,
        ]
  await runFfmpeg(['-y', ...inputOptions(format, input), '-vn', '-c:a', 'copy', ...segmenting])
}
