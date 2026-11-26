import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UnreadableAudioError, convertToWav, measureDurationMs } from './ffmpeg.ts'

const fixtures = join(import.meta.dirname, '../../../../e2e/fixtures')
const english = join(fixtures, 'en-sample.wav')
const seconds = (path: string) => (readFileSync(path).length - 44) / 32000

describe('003-voice-entries: ffmpeg helpers', () => {
  it('AC-10: measures the length of a file by decoding it', async () => {
    const measured = await measureDurationMs(english)
    expect(Math.abs(measured - seconds(english) * 1000)).toBeLessThan(100)
  })

  it('AC-10: a file with no audio in it is unreadable', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nightjar-ffmpeg-'))
    const broken = join(folder, 'broken.wav')
    await writeFile(broken, Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.alloc(64, 7)]))
    await expect(measureDurationMs(broken)).rejects.toBeInstanceOf(UnreadableAudioError)
  })

  it('AC-11: converts to a 16 kHz mono 16-bit WAV', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nightjar-ffmpeg-'))
    const output = join(folder, 'out.wav')
    await convertToWav(english, output)
    const header = readFileSync(output).subarray(0, 44)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.readUInt16LE(22)).toBe(1)
    expect(header.readUInt32LE(24)).toBe(16000)
    expect(header.readUInt16LE(34)).toBe(16)
  })
})
