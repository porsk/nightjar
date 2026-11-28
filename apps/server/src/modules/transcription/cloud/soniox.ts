import type { Language } from '@nightjar/shared'
import {
  audioForm,
  checkWith,
  deleteWith,
  readJson,
  vendorRequest,
  ProviderError,
  type CloudProvider,
  type ProviderCall,
} from './provider.ts'

export const sonioxBaseUrl = 'https://api.soniox.com/v1'
const model = 'stt-async-v6'

const stringField = (value: Record<string, unknown>, name: string) => {
  const field = value[name]
  if (typeof field !== 'string' || field === '') throw new ProviderError('provider_unavailable')
  return field
}

/** The language with the most token characters. A language that is not Hungarian counts as English. */
export function dominantLanguage(tokens: unknown): Language {
  const characters = new Map<string, number>()
  for (const token of Array.isArray(tokens) ? (tokens as unknown[]) : []) {
    const { text, language } = (token ?? {}) as { text?: unknown; language?: unknown }
    if (typeof text !== 'string' || typeof language !== 'string') continue
    characters.set(language, (characters.get(language) ?? 0) + text.length)
  }
  const top = [...characters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return top === 'hu' ? 'hu' : 'en'
}

/** Soniox async transcription. `baseUrl` is replaced in tests. */
export function createSonioxProvider({
  baseUrl = sonioxBaseUrl,
}: { baseUrl?: string } = {}): CloudProvider {
  const headers = (call: ProviderCall) => ({ authorization: `Bearer ${call.secrets.apiKey ?? ''}` })
  const json = (call: ProviderCall) => ({ ...headers(call), 'content-type': 'application/json' })

  return {
    id: 'soniox',
    label: 'Soniox',
    secrets: [{ id: 'apiKey', kind: 'secret' }],
    capabilities: {
      maxAudioMs: null,
      formats: ['webm', 'ogg', 'm4a', 'aac', 'mp3', 'wav', 'flac'],
      languages: ['hu', 'en'],
    },
    pricePerHour: { amount: 0.1, currency: 'USD' },

    checkKey: (call) =>
      checkWith(call, { url: `${baseUrl}/files?limit=1`, headers: headers(call) }),

    upload: async (call, file) => {
      const response = await vendorRequest(call, {
        method: 'POST',
        url: `${baseUrl}/files`,
        headers: headers(call),
        body: await audioForm('file', file),
        step: 'upload',
      })
      return { fileId: stringField(await readJson(response), 'id') }
    },

    start: async (call, copy, language) => {
      const auto = language === 'auto'
      const response = await vendorRequest(call, {
        method: 'POST',
        url: `${baseUrl}/transcriptions`,
        headers: json(call),
        body: JSON.stringify({
          model,
          file_id: copy.fileId,
          language_hints: auto ? ['hu', 'en'] : [language],
          ...(auto ? { enable_language_identification: true } : {}),
        }),
        step: 'start',
      })
      return { ...copy, transcriptionId: stringField(await readJson(response), 'id') }
    },

    poll: async (call, copy) => {
      const id = copy.transcriptionId ?? ''
      const status = await readJson(
        await vendorRequest(call, {
          method: 'GET',
          url: `${baseUrl}/transcriptions/${id}`,
          headers: headers(call),
        }),
      )
      if (status.status === 'error') throw new ProviderError('audio_rejected')
      if (status.status !== 'completed') return { state: 'running' }
      const transcript = await readJson(
        await vendorRequest(call, {
          method: 'GET',
          url: `${baseUrl}/transcriptions/${id}/transcript`,
          headers: headers(call),
        }),
      )
      return {
        state: 'done',
        text: typeof transcript.text === 'string' ? transcript.text : '',
        language: dominantLanguage(transcript.tokens),
      }
    },

    remove: async (call, copy) => {
      let failure: unknown
      for (const [path, id] of [
        ['transcriptions', copy.transcriptionId],
        ['files', copy.fileId],
      ] as const) {
        if (!id) continue
        try {
          await deleteWith(call, { url: `${baseUrl}/${path}/${id}`, headers: headers(call) })
        } catch (error) {
          failure ??= error
        }
      }
      if (failure)
        throw failure instanceof Error ? failure : new ProviderError('provider_unavailable')
      return 'deleted'
    },
  }
}
