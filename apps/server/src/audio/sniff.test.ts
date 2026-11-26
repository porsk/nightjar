import { describe, expect, it } from 'vitest'
import { sniffAudio } from './sniff.ts'

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((value) =>
      typeof value === 'string' ? Array.from(value, (c) => c.charCodeAt(0)) : [value],
    ),
  )

describe('003-voice-entries: audio format by content', () => {
  const formats: [string, Uint8Array, string, string][] = [
    ['webm', bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42), 'audio/webm', 'webm'],
    ['ogg opus', bytes('OggS', 0, 2, 0, 0), 'audio/ogg', 'ogg'],
    ['m4a', bytes(0, 0, 0, 0x20, 'ftypM4A '), 'audio/mp4', 'm4a'],
    ['aac (adts)', bytes(0xff, 0xf1, 0x50, 0x80), 'audio/aac', 'aac'],
    ['mp3 with a tag', bytes('ID3', 4, 0, 0), 'audio/mpeg', 'mp3'],
    ['mp3 without a tag', bytes(0xff, 0xfb, 0x90, 0x64), 'audio/mpeg', 'mp3'],
    ['wav', bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt '), 'audio/wav', 'wav'],
    ['flac', bytes('fLaC', 0, 0, 0, 0x22), 'audio/flac', 'flac'],
  ]

  for (const [name, content, mimeType, extension] of formats) {
    it(`AC-9: recognises ${name}`, () => {
      expect(sniffAudio(content)).toEqual({ mimeType, extension })
    })
  }

  it('AC-9: refuses images, text, other RIFF files and empty input', () => {
    expect(sniffAudio(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF'))).toBeUndefined()
    expect(sniffAudio(bytes('hello world, not audio'))).toBeUndefined()
    expect(sniffAudio(bytes('RIFF', 0, 0, 0, 0, 'AVI LIST'))).toBeUndefined()
    expect(sniffAudio(bytes())).toBeUndefined()
  })
})
