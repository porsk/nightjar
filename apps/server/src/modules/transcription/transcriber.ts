import type { EntryLanguage, Language } from '@nightjar/shared'
import type { ModelInfo } from './models.ts'

export interface TranscriptResult {
  text: string
  /** The language that was spoken: the asked one, or the detected one for `auto`. */
  language: Language
}

export interface Transcriber {
  /** Stored with the transcript so it is clear which model wrote it. */
  readonly modelId: string
  transcribe(wavPath: string, language: EntryLanguage): Promise<TranscriptResult>
  /** Frees the model and resolves once it is gone. The transcriber cannot be used afterwards. */
  dispose(): Promise<void>
}

/** Makes a transcriber for a model, which loads it. Called when work arrives, not at startup. */
export type TranscriberFactory = (model: ModelInfo) => Transcriber
