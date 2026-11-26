import type { TimelineItem, TimelinePage } from '@nightjar/shared'
import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { entries, recordings, transcripts } from '../../db/schema.ts'
import { badgeFor, buildExcerpt, encodeCursor, type TimelinePosition } from './timeline.ts'

const transcriptPreviewLength = 400
const maxEntriesPerDay = 1000
const bodyPreviewLength = 2000

type Db = Database['db']

interface Recordings {
  statuses: string[]
  totalDurationMs: number
  firstTranscript: string | null
}

async function recordingsOf(db: Db, userId: string, entryIds: string[]) {
  const byEntry = new Map<string, Recordings>()
  if (entryIds.length === 0) return byEntry
  const rows = await db
    .select({
      entryId: recordings.entryId,
      status: recordings.status,
      durationMs: recordings.durationMs,
      text: sql<string | null>`left(${transcripts.text}, ${transcriptPreviewLength})`,
    })
    .from(recordings)
    .leftJoin(transcripts, eq(transcripts.recordingId, recordings.id))
    .where(and(eq(recordings.userId, userId), inArray(recordings.entryId, entryIds)))
    .orderBy(asc(recordings.createdAt), asc(recordings.id))
  for (const row of rows) {
    const entry = byEntry.get(row.entryId) ?? {
      statuses: [],
      totalDurationMs: 0,
      firstTranscript: null,
    }
    entry.statuses.push(row.status)
    entry.totalDurationMs += row.durationMs
    if (row.status === 'done' && row.text && entry.firstTranscript === null) {
      entry.firstTranscript = row.text
    }
    byEntry.set(row.entryId, entry)
  }
  return byEntry
}

const newestFirst = [desc(entries.entryDate), desc(entries.createdAt), asc(entries.id)]

const after = ({ entryDate, createdAt, id }: TimelinePosition): SQL | undefined =>
  and(
    lte(entries.entryDate, entryDate),
    or(
      lt(entries.entryDate, entryDate),
      and(
        eq(entries.entryDate, entryDate),
        or(
          lt(entries.createdAt, sql`${createdAt}::timestamptz`),
          and(eq(entries.createdAt, sql`${createdAt}::timestamptz`), gt(entries.id, id)),
        ),
      ),
    ),
  )

/** One page of the signed-in user's entries, newest day first, or every entry of one day. */
export async function listEntries(
  { db }: Database,
  userId: string,
  query: { before: TimelinePosition | undefined; date: string | undefined; limit: number },
): Promise<TimelinePage> {
  const rows = await db
    .select({
      id: entries.id,
      entryDate: entries.entryDate,
      createdAt: entries.createdAt,
      bodyMd: sql<string>`left(${entries.bodyMd}, ${bodyPreviewLength})`,
      createdAtText: sql<string>`${entries.createdAt}::text`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        query.date ? eq(entries.entryDate, query.date) : undefined,
        query.before ? after(query.before) : undefined,
      ),
    )
    .orderBy(...newestFirst)
    .limit(query.date ? maxEntriesPerDay : query.limit + 1)

  const pageRows = query.date ? rows : rows.slice(0, query.limit)
  const last = pageRows.at(-1)
  const hasMore = !query.date && rows.length > query.limit
  const details = await recordingsOf(
    db,
    userId,
    pageRows.map((row) => row.id),
  )
  const items = pageRows.map((row): TimelineItem => {
    const own = details.get(row.id)
    return {
      id: row.id,
      entryDate: row.entryDate,
      createdAt: row.createdAt.toISOString(),
      excerpt: buildExcerpt(row.bodyMd, own?.firstTranscript ?? null),
      hasRecordings: own !== undefined,
      totalDurationMs: own?.totalDurationMs ?? 0,
      badge: badgeFor(own?.statuses ?? []),
    }
  })
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ entryDate: last.entryDate, createdAt: last.createdAtText, id: last.id })
        : null,
  }
}
