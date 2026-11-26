import { spawn } from 'node:child_process'

/** ffmpeg could not read the file as audio. */
export class UnreadableAudioError extends Error {}

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
export async function measureDurationMs(path: string): Promise<number> {
  const output = await runFfmpeg([
    '-i',
    path,
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
export async function convertToWav(input: string, output: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    input,
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
