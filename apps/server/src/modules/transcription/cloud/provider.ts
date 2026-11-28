import { openAsBlob } from 'node:fs'
import type { EntryLanguage, Language } from '@nightjar/shared'
import type { FailureCode } from '@nightjar/shared/recordings'

export type { FailureCode }

/** The containers `sniff.ts` stores. */
export type AudioExtension = 'webm' | 'ogg' | 'm4a' | 'aac' | 'mp3' | 'wav' | 'flac'

/** Thrown by provider code. Only the code and the HTTP status travel, never a response body. */
export class ProviderError extends Error {
  readonly code: FailureCode
  readonly httpStatus: number | undefined

  constructor(code: FailureCode, httpStatus?: number) {
    super(code)
    this.name = 'ProviderError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

/** The saved key is missing or unreadable, so the vendor was never called and the recording should wait. */
export class KeyUnavailableError extends Error {
  constructor() {
    super('no usable key')
    this.name = 'KeyUnavailableError'
  }
}

export interface SecretField {
  id: 'apiKey'
  kind: 'secret'
}

export interface ProviderCall {
  /** Decrypted, only in memory for the call. */
  secrets: Record<string, string>
  fetch: typeof fetch
  signal: AbortSignal
}

/** Ids the vendor gave for one uploaded part. Opaque to the pipeline, stored so it can be deleted later. */
export type VendorCopy = Record<string, string>

export type PollResult = { state: 'running' } | { state: 'done'; text: string; language?: Language }

export interface CloudProvider {
  /** Unique across local models and providers. */
  id: string
  /** Brand name, not translated. */
  label: string
  secrets: readonly SecretField[]
  capabilities: {
    /** Longer recordings are split. `null` means no limit under the 3 hour maximum. */
    maxAudioMs: number | null
    /** Containers the vendor accepts as they are. */
    formats: readonly AudioExtension[]
    languages: readonly Language[]
  }
  /** List price, for the description and the usage estimate. */
  pricePerHour: { amount: number; currency: 'USD' | 'EUR' }
  /** One cheap authenticated call that sends no audio. */
  checkKey: (call: ProviderCall) => Promise<'ok' | 'invalid_key' | 'unreachable'>
  upload: (
    call: ProviderCall,
    file: { path: string; extension: AudioExtension },
  ) => Promise<VendorCopy>
  /** Adds the job id to the copy. */
  start: (call: ProviderCall, copy: VendorCopy, language: EntryLanguage) => Promise<VendorCopy>
  poll: (call: ProviderCall, copy: VendorCopy) => Promise<PollResult>
  /**
   * Deletes everything the copy names. "Not found" counts as deleted. Throws ProviderError otherwise.
   * `no_delete_api` means the vendor has no way to delete what this copy names.
   */
  remove: (call: ProviderCall, copy: VendorCopy) => Promise<'deleted' | 'no_delete_api'>
}

export const uploadTimeoutMs = 15 * 60_000
export const callTimeoutMs = 30_000

const mimeTypes: Record<AudioExtension, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
}

/** Maps an HTTP status to the failure code it means. `step` tells uploads and starts from other calls. */
export function codeForStatus(status: number, step: 'upload' | 'start' | 'other'): FailureCode {
  if (status === 401 || status === 403) return 'api_key_invalid'
  if (status === 402) return 'quota_exceeded'
  if (status === 408 || status === 429 || status >= 500) return 'provider_unavailable'
  return step === 'other' ? 'provider_unavailable' : 'audio_rejected'
}

export interface VendorRequest {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string | FormData
  step?: 'upload' | 'start' | 'other'
  timeoutMs?: number
  /** Statuses that count as success besides 2xx. */
  accept?: readonly number[]
}

/** The JSON body of a vendor answer, or a ProviderError when it is not what we expect. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json()
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  } catch {
    // falls through to the error below
  }
  throw new ProviderError('provider_unavailable', response.status)
}

/**
 * One vendor call with its own timeout, joined with the job's signal and kept until the body is read.
 * A non-success status or a network error becomes a ProviderError; the response body is never read into
 * an error. Redirects are refused, so a key header or the audio never goes to another address.
 */
async function perform<T>(
  call: ProviderCall,
  request: VendorRequest,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const step = request.step ?? 'other'
  const timeout = new AbortController()
  const timer = setTimeout(
    () => {
      timeout.abort()
    },
    request.timeoutMs ?? (step === 'upload' ? uploadTimeoutMs : callTimeoutMs),
  )
  try {
    const response = await call.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: 'error',
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.any([call.signal, timeout.signal]),
    })
    if (!response.ok && !request.accept?.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderError(codeForStatus(response.status, step), response.status)
    }
    return await consume(response)
  } catch (error) {
    if (error instanceof ProviderError) throw error
    if (call.signal.aborted) throw error
    throw new ProviderError('provider_unavailable')
  } finally {
    clearTimeout(timer)
  }
}

/** A vendor call whose answer body is not needed. */
export async function vendorRequest(call: ProviderCall, request: VendorRequest): Promise<void> {
  await perform(call, request, async (response) => {
    await response.body?.cancel().catch(() => undefined)
  })
}

/** A vendor call that answers with a JSON object. */
export const vendorJson = (call: ProviderCall, request: VendorRequest) =>
  perform(call, request, readJson)

/** A multipart body whose file part streams from disk and always has the name `audio.<ext>`. */
export async function audioForm(
  field: string,
  file: { path: string; extension: AudioExtension },
): Promise<FormData> {
  const blob = await openAsBlob(file.path, { type: mimeTypes[file.extension] })
  const form = new FormData()
  form.append(field, blob, `audio.${file.extension}`)
  return form
}

/** Runs a key check: a good status is `ok`, a rejected key `invalid_key`, anything else `unreachable`. */
export async function checkWith(
  call: ProviderCall,
  request: Omit<VendorRequest, 'method' | 'timeoutMs'>,
): Promise<'ok' | 'invalid_key' | 'unreachable'> {
  try {
    await vendorRequest(call, { ...request, method: 'GET', timeoutMs: 10_000 })
    return 'ok'
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'api_key_invalid') return 'invalid_key'
    return 'unreachable'
  }
}

/** Deletes with a "not found" counting as deleted. */
export async function deleteWith(call: ProviderCall, request: Omit<VendorRequest, 'method'>) {
  await vendorRequest(call, { ...request, method: 'DELETE', accept: [404] })
}
