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
  highlighted: string
  cut_before: boolean
  cut_after: boolean
}

/**
 * The signed-in user's entries that match `terms` in their text or transcripts, best match first.
 * Each entry shows a window of the text where the words were found, the typed text before a transcript.
 * Only that window is cut out in the database, so long entries do not travel to the server.
 */
export async function searchEntries(
  { db }: Database,
  userId: string,
  terms: string,
): Promise<SearchResponse> {
  const { rows } = await db.execute<Row>(sql`
    WITH query AS (SELECT nightjar_tsquery(${terms}::text) AS tsq),
    hits AS (
      SELECT entries.id, entries.entry_date::text AS entry_date, entries.created_at, entries.body_md,
             ts_rank(entries.search_vector, query.tsq) AS rank,
             count(*) OVER () AS total
      FROM entries, query
      WHERE entries.user_id = ${userId} AND entries.search_vector @@ query.tsq
      ORDER BY rank DESC, entries.entry_date DESC, entries.created_at DESC, entries.id
      LIMIT ${searchMaxResults}
    ),
    located AS (
      SELECT hits.*, picked.source, picked.text, picked.found_at
      FROM hits, query
      CROSS JOIN LATERAL (
        SELECT candidate.source, candidate.text, found.hit_at AS found_at
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
          SELECT coalesce(
            nullif(regexp_instr(candidate.text, pattern.regex, 1, 1, 0, 'i'), 0),
            regexp_instr(unaccent(candidate.text), pattern.regex, 1, 1, 0, 'i'),
            0
          ) AS hit_at
          FROM (SELECT nightjar_highlight_pattern(query.tsq) AS regex) AS pattern
          OFFSET 0
        ) AS found
        ORDER BY found.hit_at > 0 DESC, candidate.text <> '' DESC, candidate.position, candidate.spoken_at
        LIMIT 1
      ) AS picked
    ),
    cut AS (
      SELECT located.*, greatest(1, located.found_at - ${contextBefore}) AS window_start
      FROM located
    ),
    windowed AS (
      SELECT cut.*, translate(substr(cut.text, cut.window_start, ${windowLength}), chr(1) || chr(2), '  ') AS snippet_text
      FROM cut
    )
    SELECT windowed.id, windowed.entry_date, windowed.created_at, windowed.total, windowed.source,
           windowed.snippet_text,
           windowed.window_start > 1 AS cut_before,
           windowed.window_start + ${windowLength} - 1 < length(windowed.text) AS cut_after,
           ts_headline(
             'simple', unaccent(windowed.snippet_text), nightjar_prefix_tsquery(query.tsq),
             'HighlightAll=true, StartSel=' || chr(1) || ', StopSel=' || chr(2)
           ) AS highlighted
    FROM windowed, query
    ORDER BY windowed.rank DESC, windowed.entry_date DESC, windowed.created_at DESC, windowed.id
  `)
  return {
    total: Number(rows[0]?.total ?? 0),
    results: rows.map((row) => ({
      entryId: row.id,
      entryDate: row.entry_date,
      createdAt: new Date(row.created_at).toISOString(),
      source: row.source,
      snippet: buildSnippet(row.snippet_text, row.highlighted, {
        before: row.cut_before,
        after: row.cut_after,
      }),
    })),
  }
}
