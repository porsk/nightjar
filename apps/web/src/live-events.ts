import { liveEventSchema } from '@nightjar/shared/recordings'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { transcriptionQuery } from './api.ts'

/** Keeps the screens current while the server works: transcripts that finish, the model download. */
export function useLiveEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined
    const source = new EventSource('/api/v1/events')
    let connectedBefore = false

    source.onopen = () => {
      if (connectedBefore) void queryClient.invalidateQueries()
      connectedBefore = true
    }
    const handle = (message: MessageEvent<string>) => {
      const parsed = liveEventSchema.safeParse(JSON.parse(message.data))
      if (!parsed.success) return
      const event = parsed.data
      if (event.type === 'recording.updated') {
        void queryClient.invalidateQueries({ queryKey: ['entries'] })
        return
      }
      queryClient.setQueryData(transcriptionQuery.queryKey, (current) =>
        current
          ? {
              ...current,
              state: event.state,
              downloadedBytes: event.downloadedBytes,
              totalBytes: event.totalBytes,
            }
          : current,
      )
      if (event.state !== 'downloading') {
        void queryClient.invalidateQueries({ queryKey: transcriptionQuery.queryKey })
      }
    }
    source.addEventListener('recording.updated', handle as EventListener)
    source.addEventListener('model.updated', handle as EventListener)
    return () => {
      source.close()
    }
  }, [queryClient])
}
