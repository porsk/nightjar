import {
  entryResponseSchema,
  errorResponseSchema,
  meResponseSchema,
  setupStatusSchema,
  timelinePageSchema,
  timelinePageSize,
  type CreateEntry,
  type Entry,
  type EntryLanguage,
  type Me,
  type SettingsPatch,
  type SetupRequest,
  type UpdateEntry,
} from '@nightjar/shared'
import {
  recordingSchema,
  recordingsResponseSchema,
  transcriptSchema,
  transcriptionStatusSchema,
  type Recording,
  type Transcript,
  type TranscriptionStatus,
} from '@nightjar/shared/recordings'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

async function request(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) : undefined
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(json)
    throw new ApiError(response.status, parsed.success ? parsed.data.error.code : 'unknown')
  }
  return json
}

const parse = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T =>
  schema.parse(value)

export const setupStatusQuery = queryOptions({
  queryKey: ['setup'],
  queryFn: async () => parse(setupStatusSchema, await request('GET', '/api/v1/setup')),
  staleTime: Infinity,
})

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me> => parse(meResponseSchema, await request('GET', '/api/v1/me')),
  retry: false,
  staleTime: Infinity,
})

export const createAccount = async (input: SetupRequest): Promise<Me> =>
  parse(meResponseSchema, await request('POST', '/api/v1/setup', input))

export const updateSettings = async (patch: SettingsPatch): Promise<Me> =>
  parse(meResponseSchema, await request('PATCH', '/api/v1/me/settings', patch))

export const signIn = async (credentials: { email: string; password: string }) => {
  await request('POST', '/api/v1/auth/sign-in/email', credentials)
}

export const signOut = async () => {
  await request('POST', '/api/v1/auth/sign-out')
}

const entryPath = (id: string) => `/api/v1/entries/${id}`

export const entryQuery = (id: string) =>
  queryOptions({
    queryKey: ['entries', id],
    queryFn: async (): Promise<Entry> =>
      parse(entryResponseSchema, await request('GET', entryPath(id))),
    staleTime: 5000,
  })

export const timelineQuery = infiniteQueryOptions({
  queryKey: ['timeline', 'pages'],
  queryFn: async ({ pageParam }) =>
    parse(
      timelinePageSchema,
      await request(
        'GET',
        `/api/v1/entries?limit=${String(timelinePageSize)}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    ),
  initialPageParam: '',
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
})

export const dayEntriesQuery = (day: string) =>
  queryOptions({
    queryKey: ['timeline', 'day', day],
    queryFn: async () =>
      parse(timelinePageSchema, await request('GET', `/api/v1/entries?date=${day}`)),
  })

export const createEntry = async (input: CreateEntry): Promise<Entry> =>
  parse(entryResponseSchema, await request('POST', '/api/v1/entries', input))

export const updateEntry = async (id: string, input: UpdateEntry): Promise<Entry> =>
  parse(entryResponseSchema, await request('PATCH', entryPath(id), input))

export const deleteEntry = async (id: string) => {
  await request('DELETE', entryPath(id))
}

export const entryRecordingsQuery = (entryId: string) =>
  queryOptions({
    queryKey: ['entries', entryId, 'recordings'],
    queryFn: async (): Promise<Recording[]> =>
      parse(recordingsResponseSchema, await request('GET', `${entryPath(entryId)}/recordings`)),
  })

export const audioUrl = (recordingId: string) => `/api/v1/recordings/${recordingId}/audio`

export const saveTranscript = async (recordingId: string, text: string): Promise<Transcript> =>
  parse(
    transcriptSchema,
    await request('PATCH', `/api/v1/recordings/${recordingId}/transcript`, { text }),
  )

export const retryRecording = async (recordingId: string): Promise<Recording> =>
  parse(recordingSchema, await request('POST', `/api/v1/recordings/${recordingId}/retry`))

export const transcriptionQuery = queryOptions({
  queryKey: ['admin', 'transcription'],
  queryFn: async (): Promise<TranscriptionStatus> =>
    parse(transcriptionStatusSchema, await request('GET', '/api/v1/admin/transcription')),
})

export const setTranscription = async (enabled: boolean): Promise<TranscriptionStatus> =>
  parse(transcriptionStatusSchema, await request('PUT', '/api/v1/admin/transcription', { enabled }))

export const transcribeBacklog = async () => {
  await request('POST', '/api/v1/admin/transcription/backlog')
}

export interface RecordingUpload {
  file: Blob
  filename: string
  language: EntryLanguage
  /** Adds to this entry. Without it a new entry is made for `entryDate`. */
  entryId?: string | undefined
  entryDate?: string | undefined
}

/** Uploads with XMLHttpRequest because `fetch` cannot report upload progress. */
export function uploadRecording(
  upload: RecordingUpload,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('language', upload.language)
    if (upload.entryId) form.append('entryId', upload.entryId)
    if (upload.entryDate) form.append('entryDate', upload.entryDate)
    form.append('file', upload.file, upload.filename)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/recordings')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => {
      reject(new ApiError(0, 'network'))
    }
    xhr.onabort = () => {
      reject(new DOMException('Upload cancelled', 'AbortError'))
    }
    xhr.onload = () => {
      const json: unknown = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parse(recordingSchema, json))
        return
      }
      const parsed = errorResponseSchema.safeParse(json)
      reject(new ApiError(xhr.status, parsed.success ? parsed.data.error.code : 'unknown'))
    }
    options.signal?.addEventListener('abort', () => {
      xhr.abort()
    })
    xhr.send(form)
  })
}
