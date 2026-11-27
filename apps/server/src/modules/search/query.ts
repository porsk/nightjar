import { searchMaxResults, type SearchResponse } from '@nightjar/shared/search'
import { sql } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { buildSnippet } from './snippet.ts'

interface Row extends Record<string, unknown> {
  id: string
  entry_date: string
  created_at: string
  total: string
  source: 'text' | 'transcript'
  text: string
  highlighted: string
}

/**
 * The signed-in user's entries that match `terms` in their text or transcripts, best match first.
 * Each entry shows the text that matched, the typed text when both do.
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
    shown AS (
      SELECT hits.*, source.source, translate(source.text, chr(1) || chr(2), '  ') AS text
      FROM hits, query
      CROSS JOIN LATERAL (
        SELECT candidate.source, candidate.text
        FROM (
          SELECT 0 AS position, NULL::timestamptz AS spoken_at, 'text' AS source, hits.body_md AS text
          UNION ALL
          SELECT 1, recordings.created_at, 'transcript', transcripts.text
          FROM transcripts
          JOIN recordings ON recordings.id = transcripts.recording_id
          WHERE recordings.entry_id = hits.id
        ) AS candidate
        ORDER BY nightjar_tsvector(candidate.text) @@ query.tsq DESC, candidate.position, candidate.spoken_at
        LIMIT 1
      ) AS source
    )
    SELECT shown.id, shown.entry_date, shown.created_at, shown.total, shown.source, shown.text,
           ts_headline(
             'simple', unaccent(shown.text), nightjar_prefix_tsquery(query.tsq),
             'HighlightAll=true, StartSel=' || chr(1) || ', StopSel=' || chr(2)
           ) AS highlighted
    FROM shown, query
    ORDER BY shown.rank DESC, shown.entry_date DESC, shown.created_at DESC, shown.id
  `)
  return {
    total: Number(rows[0]?.total ?? 0),
    results: rows.map((row) => ({
      entryId: row.id,
      entryDate: row.entry_date,
      createdAt: new Date(row.created_at).toISOString(),
      source: row.source,
      snippet: buildSnippet(row.text, row.highlighted),
    })),
  }
}
