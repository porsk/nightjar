import { searchMaxResults, type SearchResponse } from '@nightjar/shared/search'
import { sql } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { buildSnippet } from './snippet.ts'

const contextBefore = 70
const windowLength = 230

interface Row extends Record<string, unknown> {
  id: string
  entry_date: string
  created_at: string
  total: string
  source: 'text' | 'transcript'
  snippet_text: string
  normalized: string[]
  cut_before: boolean
  cut_after: boolean
}

const likeEscape = (word: string) => word.replace(/[\\%_]/g, '\\$&')

/** The words of a query, without quotes, one per run of non-space characters. */
const splitWords = (terms: string) =>
  terms.toWellFormed().replaceAll('"', '').replaceAll('\u0000', '').split(/\s+/).filter(Boolean)

/** The words as the database stores text: lower case and without accents. */
async function normalizeWords({ db }: Database, words: string[]) {
  const { rows } = await db.execute<{ word: string }>(sql`
    SELECT nightjar_search_text(word) AS word
    FROM jsonb_array_elements_text(${JSON.stringify(words)}::jsonb) WITH ORDINALITY AS words(word, position)
    ORDER BY position
  `)
  return [...new Set(rows.map((row) => row.word).filter((word) => word !== ''))]
}

/**
 * The signed-in user's entries whose text or transcripts contain every word of `terms` anywhere
 * inside a word, newest first. Each entry shows a window of the text around the first match, the typed
 * text before a transcript. Only that window is cut out in the database, so long entries do not travel
 * to the server.
 */
export async function searchEntries(
  database: Database,
  userId: string,
  terms: string,
): Promise<SearchResponse> {
  const words = await normalizeWords(database, splitWords(terms))
  if (words.length === 0) return { total: 0, results: [] }

  const wordsJson = JSON.stringify(words)
  const matchesAll = sql.join(
    words.map((word) => sql`entries.search_text LIKE ${`%${likeEscape(word)}%`}`),
    sql` AND `,
  )

  const { rows } = await database.db.execute<Row>(sql`
    WITH hits AS (
      SELECT entries.id, entries.entry_date::text AS entry_date, entries.created_at, entries.body_md,
             count(*) OVER () AS total
      FROM entries
      WHERE entries.user_id = ${userId} AND ${matchesAll}
      ORDER BY entries.entry_date DESC, entries.created_at DESC, entries.id
      LIMIT ${searchMaxResults}
    ),
    located AS (
      SELECT hits.*, picked.source, picked.text, picked.found_at, picked.normalized_length
      FROM hits
      CROSS JOIN LATERAL (
        SELECT candidate.source, candidate.text, found.hit_at AS found_at, found.normalized_length
        FROM (
          SELECT 0 AS position, NULL::timestamptz AS spoken_at, 'text' AS source,
                 hits.body_md AS text
          UNION ALL
          SELECT 1, recordings.created_at, 'transcript',
                 transcripts.text
          FROM recordings
          JOIN transcripts ON transcripts.recording_id = recordings.id
            AND transcripts.user_id = recordings.user_id
          WHERE recordings.entry_id = hits.id AND recordings.user_id = ${userId}
        ) AS candidate
        CROSS JOIN LATERAL (
          SELECT coalesce(min(strpos(normal.text, word)) FILTER (WHERE strpos(normal.text, word) > 0), 0) AS hit_at,
                 max(length(normal.text)) AS normalized_length
          FROM (SELECT nightjar_search_text(candidate.text) AS text OFFSET 0) AS normal,
               jsonb_array_elements_text(${wordsJson}::jsonb) AS word
        ) AS found
        ORDER BY found.hit_at > 0 DESC, candidate.text <> '' DESC, candidate.position, candidate.spoken_at
        LIMIT 1
      ) AS picked
    ),
    cut AS (
      SELECT located.*,
             greatest(located.found_at - 1, 0) AS normalized_before
      FROM located
    ),
    windowed AS (
      SELECT cut.*,
             CASE WHEN cut.normalized_length = length(cut.text) THEN cut.normalized_before
                  ELSE nightjar_original_offset(cut.text, cut.normalized_before) END AS original_before
      FROM cut
    ),
    snippets AS (
      SELECT windowed.*,
             least(
               greatest(1, windowed.original_before + 1 - ${contextBefore}),
               greatest(1, length(windowed.text) - ${windowLength} + 1)
             ) AS window_start
      FROM windowed
    )
    SELECT snippets.id, snippets.entry_date, snippets.created_at, snippets.total, snippets.source,
           substr(snippets.text, snippets.window_start, ${windowLength}) AS snippet_text,
           snippets.window_start > 1 AS cut_before,
           snippets.window_start + ${windowLength} - 1 < length(snippets.text) AS cut_after,
           ARRAY(
             SELECT nightjar_search_text(letter)
             FROM unnest(regexp_split_to_array(substr(snippets.text, snippets.window_start, ${windowLength}), ''))
               WITH ORDINALITY AS letters(letter, position)
             ORDER BY position
           ) AS normalized
    FROM snippets
    ORDER BY snippets.entry_date DESC, snippets.created_at DESC, snippets.id
  `)
  return {
    total: Number(rows[0]?.total ?? 0),
    results: rows.map((row) => ({
      entryId: row.id,
      entryDate: row.entry_date,
      createdAt: new Date(row.created_at).toISOString(),
      source: row.source,
      snippet: buildSnippet(row.snippet_text, row.normalized, words, {
        before: row.cut_before,
        after: row.cut_after,
      }),
    })),
  }
}
