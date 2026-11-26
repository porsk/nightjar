import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

/** Refreshes the timeline and Home when the server says a recording changed. */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const source = new EventSource('/api/v1/events')
    source.addEventListener('recording.updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
    })
    return () => {
      source.close()
    }
  }, [queryClient])
}
