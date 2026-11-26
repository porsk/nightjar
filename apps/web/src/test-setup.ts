import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeEventSource, FakeIntersectionObserver } from './test-fakes.ts'

beforeEach(() => {
  FakeEventSource.instances = []
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  )
  window.scrollTo = vi.fn()
})

afterEach(cleanup)
