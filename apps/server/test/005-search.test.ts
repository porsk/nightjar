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

/** Characters that unaccent turns into a plain apostrophe. */
const lookAlikes = ['ŉ', 'ʼ', 'ʻ', 'ʹ', 'ʽ', 'ˈ', '′']

interface Hit {
  entryId: string
  entryDate: string
  createdAt: string
  source: 'text' | 'transcript'
  snippet: string
}
interface Found {
  total: number
  results: Hit[]
}

describe('005-search: search API against a real Postgres', () => {
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
    const alice = await createUserWithSession(database, auth, { email: 'alice@example.test' })
    const bob = await createUserWithSession(database, auth, { email: 'bob@example.test' })
    const call = (
      user: { cookie: string } | null,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: string,
      payload?: object,
    ) =>
      test.app.inject({
        method,
        url,
        headers: user ? { cookie: user.cookie } : {},
        ...(payload ? { payload } : {}),
      })
    const search = async (user: { cookie: string }, query: string) => {
      const response = await call(user, 'POST', '/api/v1/search', { q: query })
      expect(response.statusCode).toBe(200)
      return response.json<Found>()
    }
    const ids = async (user: { cookie: string }, query: string) =>
      (await search(user, query)).results.map((hit) => hit.entryId).sort()
    return { ...test, alice, bob, call, search, ids }
  }

  const addEntry = async (
    userId: string,
    bodyMd: string,
    options: { entryDate?: string; createdAt?: string } = {},
  ) => {
    const [row] = await database.db
      .insert(entries)
      .values({
        userId,
        entryDate: options.entryDate ?? '2026-11-26',
        bodyMd,
        ...(options.createdAt ? { createdAt: new Date(options.createdAt) } : {}),
      })
      .returning()
    if (!row) throw new Error('no entry')
    return row.id
  }

  const addTranscript = async (userId: string, entryId: string, text: string) => {
    const [recording] = await database.db
      .insert(recordings)
      .values({
        userId,
        entryId,
        filePath: `media/${userId}/recordings/${crypto.randomUUID()}.webm`,
        mimeType: 'audio/webm',
        sizeBytes: 5,
        durationMs: 1000,
        language: 'hu',
        status: 'done',
      })
      .returning()
    if (!recording) throw new Error('no recording')
    await database.db
      .insert(transcripts)
      .values({ userId, recordingId: recording.id, model: 'fake', language: 'hu', text })
    return recording.id
  }

  it('AC-1: word endings do not matter in Hungarian', async () => {
    const app = await launch()
    const a = await addEntry(app.alice.id, 'Holnap kezdődik a költözésről szóló beszélgetés.')
    const b = await addEntry(app.alice.id, 'A költözéshez dobozok kellenek.')
    const c = await addEntry(app.alice.id, 'Megint a költözés jár a fejemben.')
    await addEntry(app.alice.id, 'Semmi köze hozzá.')
    expect(await app.ids(app.alice, 'költözés')).toEqual([a, b, c].sort())
  })

  it('AC-2: accents in the query are optional', async () => {
    const app = await launch()
    const move = await addEntry(app.alice.id, 'A költözés napja')
    const diary = await addEntry(app.alice.id, 'Írtam a naplóba')
    expect(await app.ids(app.alice, 'koltozes')).toEqual([move])
    expect(await app.ids(app.alice, 'naplo')).toEqual([diary])
    expect(await app.ids(app.alice, 'napló')).toEqual([diary])
    const stretched = await addEntry(app.alice.id, 'Hosszú költözésről beszéltünk')
    expect(await app.ids(app.alice, 'koltozes')).toEqual([move, stretched].sort())
  })

  it('AC-3: word endings do not matter in English', async () => {
    const app = await launch()
    const walked = await addEntry(app.alice.id, 'I walked by the river')
    const walks = await addEntry(app.alice.id, 'She walks to work')
    await addEntry(app.alice.id, 'Sat at home')
    expect(await app.ids(app.alice, 'walking')).toEqual([walked, walks].sort())
  })

  it('AC-4: says whether the match is in the typed text or in a transcript', async () => {
    const app = await launch()
    const typed = await addEntry(app.alice.id, 'Pelican in the morning')
    const spoken = await addEntry(app.alice.id, '')
    await addTranscript(app.alice.id, spoken, 'A pelican on the pier')
    const found = await app.search(app.alice, 'pelican')
    const bySource = Object.fromEntries(found.results.map((hit) => [hit.entryId, hit.source]))
    expect(bySource).toEqual({ [typed]: 'text', [spoken]: 'transcript' })
    expect(found.results.find((hit) => hit.entryId === spoken)?.snippet).toContain(
      '<mark>pelican</mark>',
    )
  })

  it('AC-4: finds an entry whose words are split between its text and its transcript', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, 'Alpha in the text')
    await addTranscript(app.alice.id, id, 'Omega in the voice')
    expect(await app.ids(app.alice, 'alpha omega')).toEqual([id])
  })

  it('AC-5: the next search reflects a new entry, an edited body and a deleted entry', async () => {
    const app = await launch()
    const created = await app.call(app.alice, 'POST', '/api/v1/entries', {
      bodyMd: 'Sparrow on the fence',
      entryDate: '2026-11-26',
    })
    const { id } = created.json<{ id: string }>()
    expect(await app.ids(app.alice, 'sparrow')).toEqual([id])

    await app.call(app.alice, 'PATCH', `/api/v1/entries/${id}`, { bodyMd: 'Heron at the lake' })
    expect(await app.ids(app.alice, 'sparrow')).toEqual([])
    expect(await app.ids(app.alice, 'heron')).toEqual([id])

    expect((await app.call(app.alice, 'DELETE', `/api/v1/entries/${id}`)).statusCode).toBe(204)
    expect(await app.ids(app.alice, 'heron')).toEqual([])
  })

  it('AC-5: the next search reflects a transcript that arrives, is edited and goes away with its entry', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, 'Plain text')
    expect(await app.ids(app.alice, 'kingfisher')).toEqual([])

    const recordingId = await addTranscript(app.alice.id, id, 'A kingfisher flew past')
    expect(await app.ids(app.alice, 'kingfisher')).toEqual([id])

    await app.call(app.alice, 'PATCH', `/api/v1/recordings/${recordingId}/transcript`, {
      text: 'A cormorant flew past',
    })
    expect(await app.ids(app.alice, 'kingfisher')).toEqual([])
    expect(await app.ids(app.alice, 'cormorant')).toEqual([id])
    expect(await app.ids(app.alice, 'plain')).toEqual([id])

    await database.db.execute(sql`delete from recordings where id = ${recordingId}`)
    expect(await app.ids(app.alice, 'cormorant')).toEqual([])
    expect(await app.ids(app.alice, 'plain')).toEqual([id])

    const again = await addTranscript(app.alice.id, id, 'A swan appeared')
    expect(await app.ids(app.alice, 'swan')).toEqual([id])
    await app.call(app.alice, 'DELETE', `/api/v1/entries/${id}`)
    expect(await app.ids(app.alice, 'swan')).toEqual([])
    expect(again).toBeTruthy()
  })

  it('AC-5: the next search finds rows the index was rebuilt for, as the migration does for old rows', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, 'Old entry about a lighthouse')
    await database.db.execute(sql`update entries set search_vector = ''`)
    expect(await app.ids(app.alice, 'lighthouse')).toEqual([])
    await database.db.execute(
      sql`update entries set search_vector = entry_search_vector(id, body_md)`,
    )
    expect(await app.ids(app.alice, 'lighthouse')).toEqual([id])
  })

  it('AC-5: text with look-alike apostrophes and backslashes can be saved, edited and searched', async () => {
    const app = await launch()
    const created = await app.call(app.alice, 'POST', '/api/v1/entries', {
      bodyMd: `Hawaiʻi ${lookAlikes.join(' ')} back\\slash O'Brien`,
      entryDate: '2026-11-26',
    })
    expect(created.statusCode).toBe(201)
    const { id } = created.json<{ id: string }>()
    expect(await app.ids(app.alice, 'Hawaiʻi')).toEqual([id])
    expect(await app.ids(app.alice, 'hawai')).toEqual([id])
    expect(await app.ids(app.alice, "O'Brien")).toEqual([id])
    const edited = await app.call(app.alice, 'PATCH', `/api/v1/entries/${id}`, {
      bodyMd: 'ʼŉʻ Kauaʻi again',
    })
    expect(edited.statusCode).toBe(200)
    expect(await app.ids(app.alice, 'Kauaʻi')).toEqual([id])
  })

  it('AC-5: a transcript with look-alike apostrophes can be created and edited', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, '')
    const recordingId = await addTranscript(app.alice.id, id, `Mauiʻs ${lookAlikes.join(' ')}`)
    expect(await app.ids(app.alice, 'maui')).toEqual([id])
    const edited = await app.call(
      app.alice,
      'PATCH',
      `/api/v1/recordings/${recordingId}/transcript`,
      { text: 'Oʻahu ʹ ʽ ˈ ′ trip' },
    )
    expect(edited.statusCode).toBe(200)
    expect(await app.ids(app.alice, 'Oʻahu')).toEqual([id])
  })

  it('AC-5: the migration backfill copes with rows that hold look-alike apostrophes', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, `Hawaiʻi ${lookAlikes.join(' ')} lighthouse`)
    await database.db.execute(sql`update entries set search_vector = ''`)
    await database.db.execute(
      sql`update entries set search_vector = entry_search_vector(id, body_md)`,
    )
    expect(await app.ids(app.alice, 'lighthouse')).toEqual([id])
  })

  it('AC-6: 50 hits in 100 KB entries come back fast, with a bounded snippet each', async () => {
    const app = await launch()
    const words = ['szél', 'folyó', 'reggel', 'költözés', 'napló', 'walk', 'river', 'dobozok']
    const filler = Array.from({ length: 7_500 }, (_, at) => words[at % words.length]).join(' ')
    for (let at = 0; at < 50; at += 1) {
      await addEntry(app.alice.id, `${filler} heron${String(at)} final heron ${filler}`)
    }
    const started = performance.now()
    const found = await app.search(app.alice, 'heron')
    const elapsed = performance.now() - started
    expect(found.results).toHaveLength(50)
    expect(elapsed).toBeLessThan(1000)
    for (const hit of found.results) {
      expect(hit.snippet.length).toBeLessThan(600)
      expect(hit.snippet).toContain('<mark>heron</mark>')
    }
  })

  it('AC-6: one card per entry, ranked, then newest first, at most 50, with the full count', async () => {
    const app = await launch()
    const strong = await addEntry(app.alice.id, 'owl owl owl owl owl', {
      entryDate: '2026-01-01',
      createdAt: '2026-01-01T10:00:00Z',
    })
    for (let day = 0; day < 59; day += 1) {
      await addEntry(
        app.alice.id,
        `A long quiet day, with one owl somewhere in it ${'filler '.repeat(20)}`,
        {
          entryDate: `2026-02-${String((day % 28) + 1).padStart(2, '0')}`,
          createdAt: new Date(Date.UTC(2026, 1, 1, 8, day)).toISOString(),
        },
      )
    }
    const found = await app.search(app.alice, 'owl')
    expect(found.total).toBe(60)
    expect(found.results).toHaveLength(50)
    expect(new Set(found.results.map((hit) => hit.entryId)).size).toBe(50)
    expect(found.results[0]?.entryId).toBe(strong)
    const rest = found.results.slice(1)
    const sortedNewestFirst = [...rest].sort(
      (a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt),
    )
    expect(rest.map((hit) => hit.entryId)).toEqual(sortedNewestFirst.map((hit) => hit.entryId))
    expect(found.results[0]).toMatchObject({
      entryDate: '2026-01-01',
      createdAt: '2026-01-01T10:00:00.000Z',
      source: 'text',
    })
  })

  it('AC-6: the snippet marks matches and escapes everything else', async () => {
    const app = await launch()
    await addEntry(app.alice.id, 'Before <img src=x onerror=alert(1)> the move & after')
    const found = await app.search(app.alice, 'move')
    expect(found.results[0]?.snippet).toBe(
      'Before &lt;img src=x onerror=alert(1)&gt; the <mark>move</mark> &amp; after',
    )
  })

  it('AC-6: the snippet keeps the accents the entry was written with', async () => {
    const app = await launch()
    await addEntry(app.alice.id, 'Annával a költözésről beszélgettünk')
    const found = await app.search(app.alice, 'koltozes')
    expect(found.results[0]?.snippet).toBe('Annával a <mark>költözésről</mark> beszélgettünk')
  })

  it('AC-7: rejects a missing query with 400 and finds nothing for an unknown word', async () => {
    const app = await launch()
    await addEntry(app.alice.id, 'Something')
    expect((await app.call(app.alice, 'POST', '/api/v1/search', {})).statusCode).toBe(400)
    expect(await app.search(app.alice, 'nonexistentword')).toEqual({ total: 0, results: [] })
  })

  it('AC-9: a search only returns the signed-in user’s entries and transcripts', async () => {
    const app = await launch()
    const mine = await addEntry(app.alice.id, 'Shared word heron')
    const mineSpoken = await addEntry(app.alice.id, '')
    await addTranscript(app.alice.id, mineSpoken, 'heron again')
    const theirs = await addEntry(app.bob.id, 'Shared word heron')
    const theirsSpoken = await addEntry(app.bob.id, '')
    await addTranscript(app.bob.id, theirsSpoken, 'heron again')
    expect(await app.ids(app.alice, 'heron')).toEqual([mine, mineSpoken].sort())
    expect(await app.ids(app.bob, 'heron')).toEqual([theirs, theirsSpoken].sort())
    expect((await app.call(null, 'POST', '/api/v1/search', { q: 'heron' })).statusCode).toBe(401)
  })

  it('AC-10: odd queries with operators and quotes answer 200, never 500', async () => {
    const app = await launch()
    await addEntry(app.alice.id, 'a b x and some words')
    const odd = [
      'a & b',
      '!x',
      '"',
      "'",
      ':*',
      '(',
      ')',
      'a | b',
      '-',
      '"unclosed phrase',
      '\\',
      'a <-> b',
      ...lookAlikes,
      ...lookAlikes.map((char) => `a${char}b & x`),
      'Hawaiʻi',
    ]
    for (const query of odd) {
      const response = await app.call(app.alice, 'POST', '/api/v1/search', { q: query })
      expect(response.statusCode, query).toBe(200)
      expect(response.json<Found>().results, query).toBeInstanceOf(Array)
    }
  })

  it('AC-12: the search term and the journal text never reach the logs', async () => {
    const app = await launch()
    const id = await addEntry(app.alice.id, `${marker} in the typed text`)
    const spoken = await addEntry(app.alice.id, '')
    await addTranscript(app.alice.id, spoken, `${marker} in the transcript`)
    expect((await app.search(app.alice, marker)).results.map((hit) => hit.entryId).sort()).toEqual(
      [id, spoken].sort(),
    )
    expect(await app.search(app.alice, `${marker}-nothing-here`)).toMatchObject({ total: 0 })
    await app.call(app.alice, 'POST', '/api/v1/search', { q: `${marker}&&(` })
    await app.call(app.alice, 'POST', '/api/v1/search', {})
    expectNoMarkersInLogs(app.capture, [marker])
  })
})
