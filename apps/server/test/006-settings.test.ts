import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { accounts, instanceSettings, users } from '../src/db/schema.ts'
import { createLogger } from '../src/logger.ts'
import { createAuth } from '../src/modules/auth/auth.ts'
import { hashPassword } from '../src/modules/auth/password.ts'
import { issueSetupCode } from '../src/modules/auth/setup-code.ts'
import { expectNoMarkersInLogs } from './support/log-capture.ts'
import { startPostgres } from './support/postgres.ts'
import { buildTestApp } from './support/test-app.ts'

const host = 'nightjar.test'
const password = 'correct horse battery'

describe('006-settings: settings API against a real Postgres', () => {
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
    await database.db.update(instanceSettings).set({ transcriptionEnabled: false })
  })

  async function launch() {
    const auth = await createAuth(database)
    const test = await buildTestApp({ database, auth })
    test.readiness.markMigrated()
    await issueSetupCode(database, test.logger)
    await test.app.ready()
    const setupCode = String(
      test.capture.lines().find((line) => typeof line['setupCode'] === 'string')?.['setupCode'],
    )
    const request = (
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      init: { payload?: object; cookie?: string } = {},
    ) =>
      test.app.inject({
        method,
        url,
        remoteAddress: '10.1.0.1',
        headers: {
          host,
          origin: `http://${host}`,
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.payload ? { payload: init.payload } : {}),
      })
    const cookieOf = (response: { cookies: { name: string; value: string }[] }) =>
      response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')

    const setup = async (uiLanguage: 'hu' | 'en' = 'hu') =>
      cookieOf(
        await request('POST', '/api/v1/setup', {
          payload: {
            setupCode,
            username: 'owner',
            name: 'Owner',
            password,
            uiLanguage,
            timeZone: 'Europe/Budapest',
            transcriptionEnabled: false,
          },
        }),
      )

    /** The second user is inserted directly, as inviting users only arrives in M6. */
    const addSecondUser = async () => {
      const [created] = await database.db
        .insert(users)
        .values({ name: 'second', username: 'second' })
        .returning()
      if (!created) throw new Error('user was not created')
      await database.db.insert(accounts).values({
        userId: created.id,
        accountId: created.id,
        providerId: 'credential',
        password: await hashPassword(password),
      })
      const response = await request('POST', '/api/v1/auth/sign-in/username', {
        payload: { username: 'second', password },
      })
      return { id: created.id, cookie: cookieOf(response) }
    }
    return { ...test, request, setup, addSecondUser }
  }

  const patch = (
    request: Awaited<ReturnType<typeof launch>>['request'],
    cookie: string,
    payload: object,
  ) => request('PATCH', '/api/v1/me/settings', { cookie, payload })

  it('AC-1: PATCH uiLanguage persists and GET /me returns it', async () => {
    const { request, setup } = await launch()
    const cookie = await setup('en')
    const response = await patch(request, cookie, { uiLanguage: 'hu' })
    expect(response.statusCode).toBe(200)
    expect(response.json<object>()).toMatchObject({ uiLanguage: 'hu' })
    const me = await request('GET', '/api/v1/me', { cookie })
    expect(me.json<object>()).toMatchObject({ uiLanguage: 'hu', username: 'owner' })
  })

  it('AC-2: PATCH entryLanguage saves hu, en and auto, and rejects other values', async () => {
    const { request, setup } = await launch()
    const cookie = await setup()
    for (const entryLanguage of ['en', 'auto', 'hu']) {
      const response = await patch(request, cookie, { entryLanguage })
      expect(response.statusCode).toBe(200)
      expect(response.json<object>()).toMatchObject({ entryLanguage })
    }
    const bad = await patch(request, cookie, { entryLanguage: 'de' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json<object>()).toMatchObject({ error: { code: 'invalid_request' } })
  })

  it('AC-3: PATCH timeZone saves a known zone and answers 400 invalid_time_zone for Mars/Base', async () => {
    const { request, setup } = await launch()
    const cookie = await setup()
    const saved = await patch(request, cookie, { timeZone: 'America/New_York' })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<object>()).toMatchObject({ timeZone: 'America/New_York' })

    const bad = await patch(request, cookie, { timeZone: 'Mars/Base' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json<object>()).toMatchObject({ error: { code: 'invalid_time_zone' } })
    const me = await request('GET', '/api/v1/me', { cookie })
    expect(me.json<object>()).toMatchObject({ timeZone: 'America/New_York' })
  })

  it('AC-1: an empty body, unknown fields and a missing session are refused', async () => {
    const { request, setup } = await launch()
    const cookie = await setup()
    expect((await patch(request, cookie, {})).statusCode).toBe(400)
    expect((await patch(request, cookie, { isAdmin: false })).statusCode).toBe(400)
    expect((await request('PATCH', '/api/v1/me/settings', { payload: {} })).statusCode).toBe(401)
  })

  it('AC-11: user A changing settings leaves user B untouched, and GET /me shows each their own', async () => {
    const { request, setup, addSecondUser } = await launch()
    const cookieA = await setup('hu')
    const b = await addSecondUser()
    const before = (await database.db.select().from(users).where(eq(users.id, b.id)))[0]

    await patch(request, cookieA, {
      uiLanguage: 'en',
      entryLanguage: 'auto',
      timeZone: 'Asia/Tokyo',
    })

    const after = (await database.db.select().from(users).where(eq(users.id, b.id)))[0]
    expect(after).toEqual(before)
    const meA = (await request('GET', '/api/v1/me', { cookie: cookieA })).json<object>()
    const meB = (await request('GET', '/api/v1/me', { cookie: b.cookie })).json<object>()
    expect(meA).toMatchObject({ uiLanguage: 'en', entryLanguage: 'auto', timeZone: 'Asia/Tokyo' })
    expect(meB).toMatchObject({ id: b.id, uiLanguage: 'en', entryLanguage: 'en', timeZone: 'UTC' })

    await patch(request, b.cookie, { timeZone: 'Europe/London' })
    const meA2 = (await request('GET', '/api/v1/me', { cookie: cookieA })).json<object>()
    expect(meA2).toMatchObject({ timeZone: 'Asia/Tokyo' })
  })

  it('AC-16: PATCH name saves a trimmed name, GET /me returns it, other users keep theirs', async () => {
    const { request, setup, addSecondUser } = await launch()
    const cookie = await setup()
    const other = await addSecondUser()
    const saved = await patch(request, cookie, { name: '  Árpád  ' })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<object>()).toMatchObject({ name: 'Árpád', username: 'owner' })
    const me = await request('GET', '/api/v1/me', { cookie })
    expect(me.json<object>()).toMatchObject({ name: 'Árpád' })
    const meOther = await request('GET', '/api/v1/me', { cookie: other.cookie })
    expect(meOther.json<object>()).toMatchObject({ name: 'second' })
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(61)],
  ])('AC-16: a name that is %s answers 400 and changes nothing', async (_label, name) => {
    const { request, setup } = await launch()
    const cookie = await setup()
    const response = await patch(request, cookie, { name })
    expect(response.statusCode).toBe(400)
    const me = await request('GET', '/api/v1/me', { cookie })
    expect(me.json<object>()).toMatchObject({ name: 'Owner' })
  })

  it('AC-16: the username cannot be changed through settings', async () => {
    const { request, setup } = await launch()
    const cookie = await setup()
    expect((await patch(request, cookie, { username: 'other' })).statusCode).toBe(400)
  })

  it('AC-13: a user created without a language choice gets en and en', async () => {
    await launch()
    const [created] = await database.db
      .insert(users)
      .values({ name: 'plain', username: 'plain' })
      .returning()
    expect(created).toMatchObject({ uiLanguage: 'en', entryLanguage: 'en' })
  })

  it('AC-13: after the wizard picked Magyar, both languages are hu', async () => {
    const { setup } = await launch()
    await setup('hu')
    const [user] = await database.db.select().from(users)
    expect(user).toMatchObject({ uiLanguage: 'hu', entryLanguage: 'hu' })
  })

  it('AC-3: zones, the username and the name never show up in the logs', async () => {
    const { request, setup, capture } = await launch()
    const cookie = await setup()
    await patch(request, cookie, { timeZone: 'Mars/Base' })
    await patch(request, cookie, { timeZone: 'Asia/Tokyo' })
    await patch(request, cookie, { name: 'ZQX-Név-4417' })
    expectNoMarkersInLogs(capture, ['Mars/Base', 'Asia/Tokyo', 'owner', 'ZQX-Név-4417'])
  })
})
