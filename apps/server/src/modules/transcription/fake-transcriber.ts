import { setTimeout as sleep } from 'node:timers/promises'
import type { EntryLanguage, Language } from '@nightjar/shared'
import type { Transcriber, TranscriberFactory, TranscriptResult } from './transcriber.ts'

export const fakeTexts: Record<Language, string> = {
  hu: 'Ez egy próbaszöveg a magyar felvételhez.',
  en: 'This is a test transcript for the English recording.',
}

export interface FakeTranscriberOptions {
  /** How long one transcription takes. */
  delayMs?: number
  /** The detected language when `auto` is asked for. */
  detected?: Language
  /** Replaces the fixed text, for tests that follow a marker through the system. */
  text?: string
  /** Adds the model id to the text, so the text of two models differs. */
  textNamesModel?: boolean
}

/** A transcriber for tests: fixed text per language, no model, and counters to check the job rules. */
export function createFakeTranscriber(options: FakeTranscriberOptions = {}) {
  const state = {
    liveInstances: 0,
    maxLiveInstances: 0,
    createdInstances: 0,
    /** How many transcribers were created per model id. */
    createdFor: {} as Record<string, number>,
    liveFor: {} as Record<string, number>,
    parallel: 0,
    maxParallel: 0,
    calls: [] as { language: EntryLanguage }[],
    failuresLeft: 0,
    hold: undefined as Promise<void> | undefined,
    delayMs: options.delayMs ?? 0,
  }

  const factory: TranscriberFactory = (model) => {
    state.liveInstances++
    state.maxLiveInstances = Math.max(state.maxLiveInstances, state.liveInstances)
    state.createdInstances++
    state.createdFor[model.id] = (state.createdFor[model.id] ?? 0) + 1
    state.liveFor[model.id] = (state.liveFor[model.id] ?? 0) + 1
    let disposed = false
    const transcriber: Transcriber = {
      modelId: model.id,
      transcribe: async (_wavPath, language): Promise<TranscriptResult> => {
        state.calls.push({ language })
        state.parallel++
        state.maxParallel = Math.max(state.maxParallel, state.parallel)
        try {
          await state.hold
          if (state.delayMs > 0) await sleep(state.delayMs)
          if (state.failuresLeft > 0) {
            state.failuresLeft--
            throw new Error('the fake transcriber was told to fail')
          }
          const spoken: Language = language === 'auto' ? (options.detected ?? 'hu') : language
          const text = options.text ?? fakeTexts[spoken]
          return {
            text: options.textNamesModel ? `${text} [${model.id}]` : text,
            language: spoken,
          }
        } finally {
          state.parallel--
        }
      },
      dispose: () => {
        if (!disposed) {
          disposed = true
          state.liveInstances--
          state.liveFor[model.id] = (state.liveFor[model.id] ?? 1) - 1
        }
        return Promise.resolve()
      },
    }
    return transcriber
  }

  return {
    factory,
    state,
    failNext: (times: number) => {
      state.failuresLeft = times
    },
    /** Makes transcriptions wait until the returned function is called. */
    holdJobs: () => {
      let release = () => {}
      state.hold = new Promise<void>((resolve) => {
        release = () => {
          state.hold = undefined
          resolve()
        }
      })
      return release
    },
  }
}

export type FakeTranscriber = ReturnType<typeof createFakeTranscriber>
