import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

const firstRetryMs = 2_000
const longestRetryMs = 60_000

/** Refreshes the timeline and Home when the server says a recording changed. Reconnects with a growing pause. */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryMs = firstRetryMs
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
    }
    const connect = () => {
      const current = new EventSource('/api/v1/events')
      source = current
      current.addEventListener('recording.updated', refresh)
      current.addEventListener('open', () => {
        retryMs = firstRetryMs
        refresh()
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
