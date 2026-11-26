import { liveEventSchema } from '@nightjar/shared/recordings'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { transcriptionQuery } from './api.ts'

const firstRetryMs = 2_000
const longestRetryMs = 60_000

/** Keeps the screens current while the server works: finished transcripts and the model download. Reconnects with a growing pause. */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryMs = firstRetryMs
    let connectedBefore = false
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
      void queryClient.invalidateQueries({ queryKey: ['entries'] })
    }
    const connect = () => {
      const current = new EventSource('/api/v1/events')
      source = current
      current.addEventListener('recording.updated', refresh)
      current.addEventListener('model.updated', (message) => {
        const parsed = liveEventSchema.safeParse(
          JSON.parse((message as MessageEvent<string>).data),
        )
        if (!parsed.success || parsed.data.type !== 'model.updated') return
        const { state, downloadedBytes, totalBytes } = parsed.data
        queryClient.setQueryData(transcriptionQuery.queryKey, (previous) =>
          previous ? { ...previous, state, downloadedBytes, totalBytes } : previous,
        )
        if (state !== 'downloading') {
          void queryClient.invalidateQueries({ queryKey: transcriptionQuery.queryKey })
        }
      })
      current.addEventListener('open', () => {
        retryMs = firstRetryMs
        refresh()
        if (connectedBefore) void queryClient.invalidateQueries()
        connectedBefore = true
      })
      current.addEventListener('error', () => {
        current.close()
        timer = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, longestRetryMs)
      })
    }
    connect()
    return () => {
      clearTimeout(timer)
      source?.close()
    }
  }, [queryClient])
}
