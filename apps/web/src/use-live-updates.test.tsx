import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from './test-fakes.ts'
import { useLiveUpdates } from './use-live-updates.ts'

function mount() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { invalidate, ...renderHook(useLiveUpdates, { wrapper }) }
}

const open = () => FakeEventSource.instances.filter((source) => !source.closed)
const fail = () => {
  act(() => FakeEventSource.instances.at(-1)?.emit('error', {}))
}
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('live updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps one connection and refreshes the timeline on recording.updated and on open', () => {
    const { invalidate } = mount()
    expect(open()).toHaveLength(1)
    act(() => open()[0]?.emit('open', {}))
    act(() => open()[0]?.emit('recording.updated', {}))
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(open()).toHaveLength(1)
  })

  it('closes a failed connection and retries after 2 s, then 4 s, 8 s, up to 60 s', async () => {
    mount()
    const pauses = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]
    for (const pause of pauses) {
      fail()
      expect(open()).toHaveLength(0)
      await wait(pause - 1)
      expect(open()).toHaveLength(0)
      await wait(1)
      expect(open()).toHaveLength(1)
    }
  })

  it('goes back to the short pause after a connection opens', async () => {
    mount()
    fail()
    await wait(2_000)
    fail()
    await wait(4_000)
    act(() => open()[0]?.emit('open', {}))
    fail()
    await wait(1_999)
    expect(open()).toHaveLength(0)
    await wait(1)
    expect(open()).toHaveLength(1)
  })

  it('stops retrying and closes the connection when unmounted', async () => {
    const { unmount } = mount()
    fail()
    unmount()
    await wait(120_000)
    expect(open()).toHaveLength(0)
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
