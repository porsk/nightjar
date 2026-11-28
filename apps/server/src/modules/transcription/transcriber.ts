import type { EntryLanguage, Language } from '@nightjar/shared'
import type { AudioExtension } from './cloud/provider.ts'

export interface TranscriptResult {
  text: string
  /** The language that was spoken: the asked one, or the detected one for `auto`. */
  language: Language
}

export interface AudioFile {
  path: string
  extension: AudioExtension
  durationMs: number
  recordingId: string
  userId: string
}

export interface Transcriber {
  /** The engine id, stored with the transcript so it is clear which engine wrote it. */
  readonly modelId: string
  /** Local engines get a 16 kHz WAV made by the job, cloud engines the stored file as it is. */
  readonly input: 'wav' | 'original'
  transcribe(
    audio: AudioFile,
    language: EntryLanguage,
    signal: AbortSignal,
  ): Promise<TranscriptResult>
  /** Frees the model and resolves once it is gone. The transcriber cannot be used afterwards. */
  dispose(): Promise<void>
}

/** Makes a transcriber for an engine (a local model or a cloud provider). Called when work arrives, not at startup. */
export type TranscriberFactory = (engineId: string) => Transcriber
