import {
  audioForm,
  checkWith,
  deleteWith,
  vendorJson,
  ProviderError,
  type CloudProvider,
  type ProviderCall,
} from './provider.ts'

export const gladiaBaseUrl = 'https://api.gladia.io/v2'
const model = 'solaria-1'

const stringField = (value: Record<string, unknown>, name: string) => {
  const field = value[name]
  if (typeof field !== 'string' || field === '') throw new ProviderError('provider_unavailable')
  return field
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** Gladia pre-recorded transcription. `baseUrl` is replaced in tests. */
export function createGladiaProvider({
  baseUrl = gladiaBaseUrl,
}: { baseUrl?: string } = {}): CloudProvider {
  const headers = (call: ProviderCall) => ({ 'x-gladia-key': call.secrets.apiKey ?? '' })

  return {
    id: 'gladia',
    label: 'Gladia',
    secrets: [{ id: 'apiKey', kind: 'secret' }],
    capabilities: {
      maxAudioMs: 135 * 60_000,
      formats: ['ogg', 'm4a', 'aac', 'mp3', 'wav', 'flac'],
      languages: ['hu', 'en'],
    },
    pricePerHour: { amount: 0.27, currency: 'EUR' },

    checkKey: (call) =>
      checkWith(call, { url: `${baseUrl}/pre-recorded?limit=1`, headers: headers(call) }),

    upload: async (call, file) => {
      const answer = await vendorJson(call, {
        method: 'POST',
        url: `${baseUrl}/upload`,
        headers: headers(call),
        body: await audioForm('audio', file),
        step: 'upload',
      })
      return { audioUrl: stringField(answer, 'audio_url') }
    },

    start: async (call, copy, language) => {
      const answer = await vendorJson(call, {
        method: 'POST',
        url: `${baseUrl}/pre-recorded`,
        headers: { ...headers(call), 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_url: copy.audioUrl,
          model,
          language_config: { languages: language === 'auto' ? ['hu', 'en'] : [language] },
        }),
        step: 'start',
      })
      return { ...copy, jobId: stringField(answer, 'id') }
    },

    poll: async (call, copy) => {
      const job = await vendorJson(call, {
        method: 'GET',
        url: `${baseUrl}/pre-recorded/${encodeURIComponent(copy.jobId ?? '')}`,
        headers: headers(call),
      })
      if (job.status === 'error') throw new ProviderError('audio_rejected')
      if (job.status !== 'done') return { state: 'running' }
      const transcription = record(record(job.result).transcription)
      const languages = Array.isArray(transcription.languages)
        ? (transcription.languages as unknown[])
        : []
      return {
        state: 'done',
        text:
          typeof transcription.full_transcript === 'string' ? transcription.full_transcript : '',
        language: languages[0] === 'hu' ? 'hu' : 'en',
      }
    },

    remove: async (call, copy) => {
      if (!copy.jobId) return 'no_delete_api'
      await deleteWith(call, {
        url: `${baseUrl}/pre-recorded/${encodeURIComponent(copy.jobId)}`,
        headers: headers(call),
      })
      return 'deleted'
    },
  }
}
