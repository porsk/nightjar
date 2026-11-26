import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { entries, recordings, transcripts } from '../src/db/schema.ts'
import { createLogger } from '../src/logger.ts'
import { createAuth } from '../src/modules/auth/auth.ts'
import { createStorage } from '../src/storage.ts'
import { expectNoMarkersInLogs } from './support/log-capture.ts'
import { startPostgres } from './support/postgres.ts'
import { buildTestApp } from './support/test-app.ts'
import { createUserWithSession } from './support/users.ts'

const marker = 'ZQX-PRIVATE-7781'

describe('002-text-entries: entries API against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer
  let database: Database
  let dataDir: string
  let clock = new Date('2026-11-26T20:30:00Z')

  beforeAll(async () => {
    postgres = await startPostgres()
    database = createDatabase(postgres.getConnectionUri(), createLogger({ level: 'silent' }))
    await database.migrate(join(import.meta.dirname, '../migrations'))
    dataDir = await mkdtemp(join(tmpdir(), 'nightjar-data-'))
  })

  afterAll(async () => {
    await database.close()
    await postgres.stop()
  })

  beforeEach(async () => {
    clock = new Date('2026-11-26T20:30:00Z')
    await database.db.execute(sql`truncate users cascade`)
  })

  async function launch() {
    const auth = await createAuth(database)
    const test = await buildTestApp({
      database,
      auth,
      now: () => clock,
      storage: createStorage(dataDir),
    })
    test.readiness.markMigrated()
    await test.app.ready()
    const alice = await createUserWithSession(database, auth, {
      email: 'alice@example.test',
      timeZone: 'Europe/Budapest',
    })
    const bob = await createUserWithSession(database, auth, {
      email: 'bob@example.test',
      timeZone: 'Europe/Budapest',
    })
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
    return { ...test, alice, bob, call }
  }

  const rowsOf = async (id: string) => database.db.select().from(entries).where(eq(entries.id, id))

  it('AC-2: the first save creates the entry and later saves update it', async () => {
    const { alice, call } = await launch()
    const created = await call(alice, 'POST', '/api/v1/entries', {
      bodyMd: 'first words',
      entryDate: '2026-11-26',
    })
    expect(created.statusCode).toBe(201)
    const entry = created.json<{ id: string; bodyMd: string; entryDate: string }>()
    expect(entry).toMatchObject({ bodyMd: 'first words', entryDate: '2026-11-26' })

    const updated = await call(alice, 'PATCH', `/api/v1/entries/${entry.id}`, {
      bodyMd: 'first words and more',
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ id: entry.id, bodyMd: 'first words and more' })
    const [row] = await rowsOf(entry.id)
    expect(row).toMatchObject({ userId: alice.id, bodyMd: 'first words and more' })
  })

  it('AC-8: GET returns the text and date of an entry', async () => {
    const { alice, call } = await launch()
    const created = await call(alice, 'POST', '/api/v1/entries', {
      bodyMd: 'to read back',
      entryDate: '2026-11-20',
    })
    const { id } = created.json<{ id: string }>()
    const read = await call(alice, 'GET', `/api/v1/entries/${id}`)
    expect(read.statusCode).toBe(200)
    expect(read.json()).toMatchObject({ id, bodyMd: 'to read back', entryDate: '2026-11-20' })
    const untouched = await call(alice, 'PATCH', `/api/v1/entries/${id}`, {})
    expect(untouched.statusCode).toBe(200)
    expect(untouched.json()).toMatchObject({ bodyMd: 'to read back', entryDate: '2026-11-20' })
  })

  it('AC-5: PATCH entryDate moves the entry to that day', async () => {
    const { alice, call } = await launch()
    const { id } = (await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'x' })).json<{
      id: string
    }>()
    const moved = await call(alice, 'PATCH', `/api/v1/entries/${id}`, {
      entryDate: '2026-11-20',
    })
    expect(moved.statusCode).toBe(200)
    expect((await rowsOf(id))[0]?.entryDate).toBe('2026-11-20')
  })

  it('AC-5: today in the time zone of the user can be picked, tomorrow cannot', async () => {
    const { alice, call } = await launch()
    const { id } = (await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'x' })).json<{
      id: string
    }>()
    clock = new Date('2026-11-26T23:30:00Z')
    const today = await call(alice, 'PATCH', `/api/v1/entries/${id}`, { entryDate: '2026-11-27' })
    expect(today.statusCode).toBe(200)
    const tomorrow = await call(alice, 'PATCH', `/api/v1/entries/${id}`, {
      entryDate: '2026-11-28',
    })
    expect(tomorrow.statusCode).toBe(400)
  })

  it('AC-6: an entry made at 23:30 UTC gets the next day in Budapest', async () => {
    const { alice, call } = await launch()
    clock = new Date('2026-11-26T23:30:00Z')
    const created = await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'late' })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ entryDate: '2026-11-27' })
  })

  it('AC-7: bad dates and long bodies answer 400 with a stable code and change nothing', async () => {
    const { alice, call } = await launch()
    const { id } = (
      await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'keep me', entryDate: '2026-11-26' })
    ).json<{ id: string }>()
    const before = await rowsOf(id)

    const bad = [
      { payload: { entryDate: '2026-11-27' }, code: 'invalid_entry_date' },
      { payload: { entryDate: '2026-02-30' }, code: 'invalid_entry_date' },
      { payload: { entryDate: 'not a date' }, code: 'invalid_entry_date' },
      { payload: { bodyMd: 'a'.repeat(100_001) }, code: 'body_too_long' },
    ]
    for (const { payload, code } of bad) {
      const patch = await call(alice, 'PATCH', `/api/v1/entries/${id}`, payload)
      expect(patch.statusCode, code).toBe(400)
      expect(patch.json()).toMatchObject({ error: { code } })
      const create = await call(alice, 'POST', '/api/v1/entries', payload)
      expect(create.statusCode, code).toBe(400)
      expect(create.json()).toMatchObject({ error: { code } })
    }
    expect(await rowsOf(id)).toEqual(before)
    expect(await database.db.select().from(entries)).toHaveLength(1)
  })

  it('AC-11: user B gets 404 on GET, PATCH and DELETE of the entry of user A', async () => {
    const { alice, bob, call } = await launch()
    const { id } = (
      await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'private', entryDate: '2026-11-26' })
    ).json<{ id: string }>()
    const before = await rowsOf(id)

    for (const [method, payload] of [
      ['GET', undefined],
      ['PATCH', { bodyMd: 'hijacked', entryDate: '2026-11-01' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call(bob, method, `/api/v1/entries/${id}`, payload)
      expect(response.statusCode, method).toBe(404)
      expect(response.json(), method).toMatchObject({ error: { code: 'entry_not_found' } })
    }
    expect(await rowsOf(id)).toEqual(before)
    expect((await call(alice, 'GET', `/api/v1/entries/${id}`)).statusCode).toBe(200)
  })

  it('AC-11: unknown and malformed ids answer 404, no session answers 401', async () => {
    const { alice, call } = await launch()
    const unknown = await call(alice, 'GET', '/api/v1/entries/6f1c5c0e-7f0c-4a53-8f3a-0d6c1f0a9b11')
    expect(unknown.statusCode).toBe(404)
    expect((await call(alice, 'GET', '/api/v1/entries/not-a-uuid')).statusCode).toBe(404)
    expect(
      (await call(null, 'GET', '/api/v1/entries/6f1c5c0e-7f0c-4a53-8f3a-0d6c1f0a9b11')).statusCode,
    ).toBe(401)
    expect((await call(null, 'POST', '/api/v1/entries', { bodyMd: 'x' })).statusCode).toBe(401)
  })

  async function seedRecordings(userId: string, entryId: string, names: string[]) {
    const keys: string[] = []
    for (const name of names) {
      const key = `media/${userId}/recordings/${name}.webm`
      await mkdir(join(dataDir, `media/${userId}/recordings`), { recursive: true })
      await writeFile(join(dataDir, key), 'audio')
      const [recording] = await database.db
        .insert(recordings)
        .values({
          userId,
          entryId,
          filePath: key,
          mimeType: 'audio/webm',
          sizeBytes: 5,
          durationMs: 1000,
          language: 'en',
          status: 'done',
        })
        .returning()
      if (!recording) throw new Error('recording was not created')
      await database.db.insert(transcripts).values({
        userId,
        recordingId: recording.id,
        model: 'fake',
        language: 'en',
        text: 'spoken words',
      })
      keys.push(key)
    }
    return keys
  }

  it('AC-9: deleting an entry removes its recordings, transcripts and audio files', async () => {
    const { alice, bob, call } = await launch()
    const mine = (await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'mine' })).json<{
      id: string
    }>()
    const theirs = (await call(bob, 'POST', '/api/v1/entries', { bodyMd: 'theirs' })).json<{
      id: string
    }>()
    const myFiles = await seedRecordings(alice.id, mine.id, ['one', 'two'])
    const theirFiles = await seedRecordings(bob.id, theirs.id, ['other'])
    for (const key of myFiles) expect(existsSync(join(dataDir, key))).toBe(true)

    const deleted = await call(alice, 'DELETE', `/api/v1/entries/${mine.id}`)
    expect(deleted.statusCode).toBe(204)

    expect(await rowsOf(mine.id)).toHaveLength(0)
    expect(await database.db.select().from(recordings)).toHaveLength(1)
    expect(await database.db.select().from(transcripts)).toHaveLength(1)
    for (const key of myFiles) expect(existsSync(join(dataDir, key))).toBe(false)
    for (const key of theirFiles) expect(existsSync(join(dataDir, key))).toBe(true)
    expect((await call(alice, 'GET', `/api/v1/entries/${mine.id}`)).statusCode).toBe(404)
  })

  it('AC-13: marker text never shows up in the logs, for create, edit, validation error and delete', async () => {
    const { alice, call, capture } = await launch()
    const created = await call(alice, 'POST', '/api/v1/entries', {
      bodyMd: `${marker} body`,
      entryDate: '2026-11-26',
    })
    const { id } = created.json<{ id: string }>()
    await seedRecordings(alice.id, id, [`${marker}-file`])
    await call(alice, 'PATCH', `/api/v1/entries/${id}`, { bodyMd: `${marker} edited` })
    const invalid = await call(alice, 'PATCH', `/api/v1/entries/${id}`, {
      bodyMd: `${marker} too late`,
      entryDate: '2099-01-01',
    })
    expect(invalid.statusCode).toBe(400)
    await call(alice, 'POST', '/api/v1/entries', { bodyMd: 'a'.repeat(100_001) + marker })
    await call(alice, 'GET', `/api/v1/entries/${id}`)
    await call(alice, 'DELETE', `/api/v1/entries/${id}`)
    expectNoMarkersInLogs(capture, [marker])
  })
})
