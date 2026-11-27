import { z } from 'zod'

export const searchMinLength = 2
export const searchMaxResults = 50
export const searchDebounceMs = 300

export const searchSourceSchema = z.enum(['text', 'transcript'])
export type SearchSource = z.infer<typeof searchSourceSchema>

export const searchResultSchema = z.object({
  entryId: z.string(),
  entryDate: z.string(),
  createdAt: z.string(),
  source: searchSourceSchema,
  /** Escaped HTML in which only `<mark>` tags are markup. */
  snippet: z.string(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  results: z.array(searchResultSchema).max(searchMaxResults),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>
