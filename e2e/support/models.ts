export const turboId = 'whisper-large-v3-turbo-int8'
export const largeId = 'whisper-large-v3-int8'

type RowState = 'not_downloaded' | 'downloading' | 'downloaded' | 'failed'

interface RowOptions {
  downloadedBytes?: number
  useWhenReady?: boolean
  error?: 'download_failed' | 'disk_full'
}

export function modelRow(id: string, state: RowState, options: RowOptions = {}) {
  return {
    id,
    state,
    downloadBytes: id === turboId ? 563_790_207 + 643_854 : 1_068_482_488 + 643_854,
    diskBytes: id === turboId ? 1_036_617_698 : 1_775_753_918,
    downloadedBytes: options.downloadedBytes ?? 0,
    useWhenReady: options.useWhenReady ?? false,
    error: options.error ?? null,
  }
}

/** A transcription status like the admin API sends it, for tests that fake the response. */
export function fakeStatus(
  turbo: ReturnType<typeof modelRow>,
  large: ReturnType<typeof modelRow>,
  overrides: object = {},
) {
  return {
    enabled: true,
    state: 'ready',
    downloadedBytes: turbo.downloadBytes,
    totalBytes: turbo.downloadBytes,
    backlogCount: 0,
    activeModel: turboId,
    models: [turbo, large],
    ...overrides,
  }
}
