import { describe, expect, it } from 'vitest'
import {
  searchDebounceMs,
  searchMaxResults,
  searchMinLength,
  searchResponseSchema,
} from './search.ts'

describe('005-search: shared schemas', () => {
  it('AC-7: a search starts from 2 characters', () => {
    expect(searchMinLength).toBe(2)
  })

  it('AC-8: the request goes out 300 ms after the last keystroke', () => {
    expect(searchDebounceMs).toBe(300)
  })

  it('AC-6: a response holds at most 50 results', () => {
    const result = {
      entryId: 'e1',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T19:00:00.000Z',
      source: 'text',
      snippet: 'a <mark>b</mark>',
    }
    expect(searchMaxResults).toBe(50)
    expect(
      searchResponseSchema.safeParse({ total: 50, results: Array(50).fill(result) }).success,
    ).toBe(true)
    expect(
      searchResponseSchema.safeParse({ total: 51, results: Array(51).fill(result) }).success,
    ).toBe(false)
  })
})
