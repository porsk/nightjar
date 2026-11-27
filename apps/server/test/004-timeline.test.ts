import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { entries, recordings, transcripts } from '../src/db/schema.ts'
import { createLogger } from '../src/logger.ts'
import { createAuth } from '../src/modules/auth/auth.ts'
import { expectNoMarkersInLogs } from './support/log-capture.ts'
import { startPostgres } from './support/postgres.ts'
import { buildTestApp } from './support/test-app.ts'
import { createUserWithSession } from './support/users.ts'

const marker = 'ZQX-PRIVATE-7781'

interface Item {
  id: string
  entryDate: string
  createdAt: string
  excerpt: string | null
  hasRecordings: boolean
  totalDurationMs: number
  badge: 'working' | 'off' | 'failed' | null
}
interface Page {
  items: Item[]
  nextCursor: string | null
}

type Status = 'pending' | 'transcribing' | 'done' | 'failed' | 'skipped'

describe('004-timeline: timeline API against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer
  let database: Database

  beforeAll(async () => {
    postgres = await startPostgres()
    database = createDatabase(postgres.getConnectionUri(), createLogger({ level: 'silent' }))
    await database.migrate(join(import.meta.dirname, '../migrations'))
  })

  afterAll(async () => {
    await database.close()
    await postgres.stop()
  })

  beforeEach(async () => {
    await database.db.execute(sql`truncate users cascade`)
  })

  async function launch() {
    const auth = await createAuth(database)
    const test = await buildTestApp({ database, auth })
    test.readiness.markMigrated()
    await test.app.ready()
    const alice = await createUserWithSession(database, auth, {
      username: 'alice',
      timeZone: 'Europe/Budapest',
    })
    const bob = await createUserWithSession(database, auth, {
      username: 'bob',
      timeZone: 'Europe/Budapest',
    })
    const get = (user: { cookie: string } | null, url: string) =>
      test.app.inject({ method: 'GET', url, headers: user ? { cookie: user.cookie } : {} })
    const page = async (user: { cookie: string }, query = '') => {
      const response = await get(user, `/api/v1/entries${query}`)
      expect(response.statusCode).toBe(200)
      return response.json<Page>()
    }
    return { ...test, alice, bob, get, page }
  }

  const addEntry = async (
    userId: string,
    entryDate: string,
    createdAt: string,
    bodyMd = 'text',
  ) => {
    const [row] = await database.db
      .insert(entries)
      .values({ userId, entryDate, bodyMd, createdAt: new Date(createdAt) })
      .returning()
    if (!row) throw new Error('no entry')
    return row.id
  }

  const addRecording = async (
    userId: string,
    entryId: string,
    status: Status,
    durationMs: number,
    transcript?: string,
  ) => {
    const [row] = await database.db
      .insert(recordings)
      .values({
        userId,
        entryId,
        filePath: `media/${userId}/recordings/${crypto.randomUUID()}.webm`,
        mimeType: 'audio/webm',
        sizeBytes: 5,
        durationMs,
        language: 'en',
        status,
      })
      .returning()
    if (!row) throw new Error('no recording')
    if (transcript !== undefined) {
      await database.db
        .insert(transcripts)
        .values({ userId, recordingId: row.id, model: 'fake', language: 'en', text: transcript })
    }
  }

  it('AC-1: days are newest first and entries within a day are newest created first', async () => {
    const { alice, page } = await launch()
    const older = await addEntry(alice.id, '2026-11-23', '2026-11-23T08:00:00Z')
    const todayEarly = await addEntry(alice.id, '2026-11-26', '2026-11-26T08:00:00Z')
    const yesterday = await addEntry(alice.id, '2026-11-25', '2026-11-25T22:10:00Z')
    const todayLate = await addEntry(alice.id, '2026-11-26', '2026-11-26T19:42:00Z')
    const backdated = await addEntry(alice.id, '2026-11-23', '2026-11-26T20:00:00Z')

    const { items } = await page(alice)
    expect(items.map((item) => item.id)).toEqual([
      todayLate,
      todayEarly,
      yesterday,
      backdated,
      older,
    ])
  })

  it('AC-3: items carry the excerpt, the recordings flag and the total length', async () => {
    const { alice, page } = await launch()
    const textOnly = await addEntry(alice.id, '2026-11-26', '2026-11-26T10:00:00Z', 'Just **text**')
    const voiceOnly = await addEntry(alice.id, '2026-11-26', '2026-11-26T11:00:00Z', '')
    await addRecording(alice.id, voiceOnly, 'done', 108_000, 'Spoken words')
    const both = await addEntry(alice.id, '2026-11-26', '2026-11-26T12:00:00Z', 'Written part')
    await addRecording(alice.id, both, 'done', 60_000, 'Spoken part')
    await addRecording(alice.id, both, 'done', 2_500, 'More speech')
    const silent = await addEntry(alice.id, '2026-11-26', '2026-11-26T13:00:00Z', '')
    await addRecording(alice.id, silent, 'skipped', 15_000)

    const byId = new Map((await page(alice)).items.map((item) => [item.id, item]))
    expect(byId.get(textOnly)).toMatchObject({
      excerpt: 'Just text',
      hasRecordings: false,
      totalDurationMs: 0,
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T10:00:00.000Z',
    })
    expect(byId.get(voiceOnly)).toMatchObject({
      excerpt: 'Spoken words',
      hasRecordings: true,
      totalDurationMs: 108_000,
    })
    expect(byId.get(both)).toMatchObject({
      excerpt: 'Written part',
      hasRecordings: true,
      totalDurationMs: 62_500,
    })
    expect(byId.get(silent)).toMatchObject({
      excerpt: null,
      hasRecordings: true,
      totalDurationMs: 15_000,
    })
  })

  it('AC-4: the badge follows the recording statuses', async () => {
    const { alice, page } = await launch()
    const withStatuses = async (hour: number, statuses: Status[]) => {
      const id = await addEntry(
        alice.id,
        '2026-11-26',
        `2026-11-26T${String(hour).padStart(2, '0')}:00:00Z`,
        '',
      )
      for (const status of statuses) await addRecording(alice.id, id, status, 1000)
      return id
    }
    const failed = await withStatuses(1, ['done', 'failed', 'pending'])
    const working = await withStatuses(2, ['done', 'transcribing', 'skipped'])
    const pending = await withStatuses(3, ['pending'])
    const off = await withStatuses(4, ['done', 'skipped'])
    const clean = await withStatuses(5, ['done'])
    const textOnly = await withStatuses(6, [])

    const badges = new Map((await page(alice)).items.map((item) => [item.id, item.badge]))
    expect(badges.get(failed)).toBe('failed')
    expect(badges.get(working)).toBe('working')
    expect(badges.get(pending)).toBe('working')
    expect(badges.get(off)).toBe('off')
    expect(badges.get(clean)).toBeNull()
    expect(badges.get(textOnly)).toBeNull()
  })

  async function seed75(userId: string) {
    const ids: string[] = []
    for (let index = 0; index < 75; index += 1) {
      // groups of 5 share one timestamp, so the id has to break ties
      const day = 1 + Math.floor(index / 15)
      const minute = Math.floor(index / 5)
      ids.push(
        await addEntry(
          userId,
          `2026-10-${String(day).padStart(2, '0')}`,
          `2026-10-${String(day).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00Z`,
          `entry ${String(index)}`,
        ),
      )
    }
    return ids
  }

  it('AC-5: 75 entries come in pages of 30, 30 and 15, each once', async () => {
    const { alice, page } = await launch()
    const ids = await seed75(alice.id)

    const first = await page(alice)
    expect(first.items).toHaveLength(30)
    const second = await page(alice, `?before=${first.nextCursor ?? ''}`)
    expect(second.items).toHaveLength(30)
    const third = await page(alice, `?before=${second.nextCursor ?? ''}`)
    expect(third.items).toHaveLength(15)
    expect(third.nextCursor).toBeNull()

    const seen = [...first.items, ...second.items, ...third.items].map((item) => item.id)
    expect(new Set(seen).size).toBe(75)
    expect([...seen].sort()).toEqual([...ids].sort())
  })

  it('AC-5: entries added and deleted between pages cause no duplicates and no gaps', async () => {
    const { alice, page } = await launch()
    const ids = await seed75(alice.id)

    const first = await page(alice)
    const firstIds = first.items.map((item) => item.id)
    const addedNewest = await addEntry(alice.id, '2026-11-01', '2026-12-01T10:00:00Z')
    const addedOld = await addEntry(alice.id, '2026-09-01', '2026-09-01T10:00:00Z')
    const deletedOnSeenPage = firstIds[4] ?? ''
    const upcoming = (await page(alice, `?before=${first.nextCursor ?? ''}`)).items.map(
      (item) => item.id,
    )
    const deletedAhead = upcoming[3] ?? ''
    await database.db.execute(
      sql`delete from entries where id in (${deletedOnSeenPage}, ${deletedAhead})`,
    )

    const second = await page(alice, `?before=${first.nextCursor ?? ''}`)
    const third = await page(alice, `?before=${second.nextCursor ?? ''}`)
    const seen = [...firstIds, ...second.items.map((i) => i.id), ...third.items.map((i) => i.id)]
    expect(new Set(seen).size).toBe(seen.length)
    const expected = [...ids, addedOld].filter((id) => id !== deletedOnSeenPage)
    expect(seen.filter((id) => id !== deletedOnSeenPage).sort()).toEqual(
      expected.filter((id) => id !== deletedAhead).sort(),
    )
    expect(seen).not.toContain(addedNewest)
    expect(seen).not.toContain(deletedAhead)
  })

  it('AC-5: entries created within the same millisecond are not skipped between pages', async () => {
    const { alice, page } = await launch()
    const ids: string[] = []
    for (let index = 0; index < 6; index += 1) {
      const [row] = await database.db
        .insert(entries)
        .values({
          userId: alice.id,
          entryDate: '2026-11-26',
          bodyMd: String(index),
          createdAt:
            sql`'2026-11-26 10:00:00.123000+00'::timestamptz + ${index} * interval '1 microsecond'` as never,
        })
        .returning()
      ids.push(row?.id ?? '')
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const next: Page = await page(alice, `?limit=1${cursor ? `&before=${cursor}` : ''}`)
      seen.push(...next.items.map((item) => item.id))
      cursor = next.nextCursor
    } while (cursor)
    expect(seen).toEqual([...ids].reverse())
  })

  it('AC-5: the limit is checked and a broken cursor is refused', async () => {
    const { alice, get } = await launch()
    expect((await get(alice, '/api/v1/entries?limit=0')).statusCode).toBe(400)
    expect((await get(alice, '/api/v1/entries?limit=101')).statusCode).toBe(400)
    const broken = await get(alice, '/api/v1/entries?before=nonsense')
    expect(broken.statusCode).toBe(400)
    expect(broken.json()).toMatchObject({ error: { code: 'invalid_cursor' } })
  })

  it('AC-6: a user with no entries gets an empty page', async () => {
    const { alice, page } = await launch()
    expect(await page(alice)).toEqual({ items: [], nextCursor: null })
    expect(await page(alice, '?date=2026-11-26')).toEqual({ items: [], nextCursor: null })
  })

  it('AC-8: ?date= returns only the entries of that day, newest first', async () => {
    const { alice, page, get } = await launch()
    await addEntry(alice.id, '2026-11-25', '2026-11-25T20:00:00Z')
    const early = await addEntry(alice.id, '2026-11-26', '2026-11-26T08:00:00Z')
    const late = await addEntry(alice.id, '2026-11-26', '2026-11-26T19:00:00Z')
    await addEntry(alice.id, '2026-11-27', '2026-11-27T08:00:00Z')

    const today = await page(alice, '?date=2026-11-26')
    expect(today.items.map((item) => item.id)).toEqual([late, early])
    expect(today.nextCursor).toBeNull()
    expect((await get(alice, '/api/v1/entries?date=2026-13-40')).statusCode).toBe(400)
    expect((await get(alice, '/api/v1/entries?date=2026-11-26&before=abc')).statusCode).toBe(400)
  })

  it('AC-10: an entry made at 23:30 UTC for the next day keeps its date and its exact time', async () => {
    const { alice, page } = await launch()
    await addEntry(alice.id, '2026-11-27', '2026-11-26T23:30:00Z')
    const { items } = await page(alice)
    expect(items[0]).toMatchObject({
      entryDate: '2026-11-27',
      createdAt: '2026-11-26T23:30:00.000Z',
    })
  })

  it('AC-11: a user never sees another user’s entries, and a foreign cursor stays scoped', async () => {
    const { alice, bob, page, get } = await launch()
    const mine = await addEntry(alice.id, '2026-11-26', '2026-11-26T10:00:00Z', 'mine')
    for (let index = 0; index < 35; index += 1) {
      await addEntry(bob.id, '2026-11-26', `2026-11-26T11:${String(index).padStart(2, '0')}:00Z`)
    }
    const bobsEntry = await addEntry(bob.id, '2026-11-26', '2026-11-26T09:00:00Z', 'bobs')
    await addRecording(bob.id, bobsEntry, 'failed', 5000)

    const aliceList = await page(alice)
    expect(aliceList.items.map((item) => item.id)).toEqual([mine])
    expect((await page(alice, '?date=2026-11-26')).items.map((item) => item.id)).toEqual([mine])

    const bobFirst = await page(bob)
    expect(bobFirst.items).toHaveLength(30)
    const withBobsCursor = await page(alice, `?before=${bobFirst.nextCursor ?? ''}`)
    expect(withBobsCursor.items.map((item) => item.id)).toEqual([mine])

    expect((await get(null, '/api/v1/entries')).statusCode).toBe(401)
    expect((await get(null, '/api/v1/entries?date=2026-11-26')).statusCode).toBe(401)
  })

  it('AC-3: excerpts and transcripts are never written to the logs', async () => {
    const { alice, page, capture } = await launch()
    const id = await addEntry(alice.id, '2026-11-26', '2026-11-26T10:00:00Z', `${marker} body`)
    await addRecording(alice.id, id, 'done', 1000, `${marker} transcript`)
    expect((await page(alice)).items[0]?.excerpt).toContain(marker)
    await page(alice, '?date=2026-11-26')
    expectNoMarkersInLogs(capture, [marker])
  })
})
