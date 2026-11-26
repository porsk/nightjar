export interface AudioKind {
  mimeType: string
  extension: string
}

export const sniffLength = 16

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0))

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte)

/** Finds the audio format from the first bytes of a file. The file name and declared type are never used. */
export function sniffAudio(bytes: Uint8Array): AudioKind | undefined {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mimeType: 'audio/webm', extension: 'webm' }
  }
  if (ascii(bytes, 0, 'OggS')) return { mimeType: 'audio/ogg', extension: 'ogg' }
  if (ascii(bytes, 0, 'fLaC')) return { mimeType: 'audio/flac', extension: 'flac' }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) {
    return { mimeType: 'audio/wav', extension: 'wav' }
  }
  if (ascii(bytes, 4, 'ftyp')) return { mimeType: 'audio/mp4', extension: 'm4a' }
  if (ascii(bytes, 0, 'ID3')) return { mimeType: 'audio/mpeg', extension: 'mp3' }

  const first = bytes[0] ?? 0
  const second = bytes[1] ?? 0
  if (first === 0xff && (second & 0xe0) === 0xe0) {
    const layer = (second >> 1) & 0b11
    if (layer === 0b00) return { mimeType: 'audio/aac', extension: 'aac' }
    if (layer === 0b01) return { mimeType: 'audio/mpeg', extension: 'mp3' }
  }
  return undefined
}
