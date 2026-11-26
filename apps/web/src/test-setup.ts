import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeEventSource, FakeIntersectionObserver } from './test-fakes.ts'

// Plain assignments, so tests that call vi.unstubAllGlobals() keep them.
Object.assign(globalThis, {
  EventSource: FakeEventSource,
  IntersectionObserver: FakeIntersectionObserver,
  matchMedia: (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList,
})

beforeEach(() => {
  FakeEventSource.instances = []
  FakeIntersectionObserver.instances = []
  window.scrollTo = vi.fn()
})

afterEach(cleanup)
