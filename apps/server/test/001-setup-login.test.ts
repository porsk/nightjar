import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type Database } from '../src/database.ts'
import { accounts, instanceSettings, sessions, users } from '../src/db/schema.ts'
import { createLogger } from '../src/logger.ts'
import { createAuth } from '../src/modules/auth/auth.ts'
import { issueSetupCode } from '../src/modules/auth/setup-code.ts'
import { expectNoMarkersInLogs } from './support/log-capture.ts'
import { startPostgres } from './support/postgres.ts'
import type { TranscriptionService } from '../src/modules/transcription/service.ts'
import { buildTestApp, inertTranscription } from './support/test-app.ts'

const host = 'nightjar.test'
const password = 'correct horse battery'
const validSetup = {
  username: 'Owner.Name',
  name: 'Örs',
  password,
  uiLanguage: 'hu',
  timeZone: 'Europe/Budapest',
  transcriptionEnabled: false,
}

describe('001-setup-login: setup and login against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer
  let database: Database
  let ipCounter = 0

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

  async function launch(
    options: {
      trustProxy?: number
      rateLimitMax?: number
      transcription?: TranscriptionService
    } = {},
  ) {
    const auth = await createAuth(database)
    const test = await buildTestApp({ database, auth, ...options })
    test.readiness.markMigrated()
    await issueSetupCode(database, test.logger)
    await test.app.ready()
    const issued = test.capture.lines().find((line) => typeof line['setupCode'] === 'string')
    const setupCode = issued ? String(issued['setupCode']) : 'none'
    const ip = `10.0.0.${String(++ipCounter)}`

    const request = (
      method: 'GET' | 'POST',
      url: string,
      init: { payload?: object; cookie?: string; headers?: Record<string, string> } = {},
    ) =>
      test.app.inject({
        method,
        url,
        remoteAddress: ip,
        headers: {
          host,
          origin: `http://${host}`,
          ...(init.cookie ? { cookie: init.cookie } : {}),
          ...init.headers,
        },
        ...(init.payload ? { payload: init.payload } : {}),
      })
    const setup = (overrides: object = {}, code = setupCode) =>
      request('POST', '/api/v1/setup', {
        payload: { ...validSetup, setupCode: code, ...overrides },
      })
    const login = (username: string, pass: string) =>
      request('POST', '/api/v1/auth/sign-in/username', { payload: { username, password: pass } })
    return { ...test, setupCode, ip, request, setup, login }
  }

  const cookieOf = (response: { cookies: { name: string; value: string }[] }) =>
    response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')

  const userCount = async () => (await database.db.select().from(users)).length

  it('AC-1: asks for setup while the database is empty', async () => {
    const { request } = await launch()
    const response = await request('GET', '/api/v1/setup')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ needed: true })
  })

  it('AC-4: the wizard creates the admin with its settings and signs in', async () => {
    const { setup, request } = await launch()
    const response = await setup()
    expect(response.statusCode).toBe(201)

    const [user, ...others] = await database.db.select().from(users)
    expect(others).toHaveLength(0)
    expect(user).toMatchObject({
      username: 'owner.name',
      name: 'Örs',
      email: null,
      isAdmin: true,
      uiLanguage: 'hu',
      entryLanguage: 'hu',
      timeZone: 'Europe/Budapest',
    })
    const [settings] = await database.db.select().from(instanceSettings)
    expect(settings?.transcriptionEnabled).toBe(false)

    const me = await request('GET', '/api/v1/me', { cookie: cookieOf(response) })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ username: 'owner.name', name: 'Örs', isAdmin: true })
    expect((await request('GET', '/api/v1/setup')).json()).toEqual({ needed: false })
  })

  it('AC-5: choosing transcription stores the flag and starts the model download', async () => {
    const resume = vi.fn(() => Promise.resolve())
    const { setup } = await launch({ transcription: { ...inertTranscription, resume } })
    expect((await setup({ transcriptionEnabled: true })).statusCode).toBe(201)
    const [settings] = await database.db.select().from(instanceSettings)
    expect(settings?.transcriptionEnabled).toBe(true)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('AC-5: choosing "not now" starts no download', async () => {
    const resume = vi.fn(() => Promise.resolve())
    const { setup } = await launch({ transcription: { ...inertTranscription, resume } })
    expect((await setup({ transcriptionEnabled: false })).statusCode).toBe(201)
    expect(resume).not.toHaveBeenCalled()
  })

  it('AC-6: setup answers 409 setup_done once an account exists and creates nothing', async () => {
    const { setup } = await launch()
    await setup()
    const again = await setup({ username: 'second' })
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ error: { code: 'setup_done' } })
    expect(await userCount()).toBe(1)
  })

  it('AC-7: two parallel setups create exactly one account', async () => {
    const { setup } = await launch()
    const [first, second] = await Promise.all([
      setup({ username: 'first' }),
      setup({ username: 'second' }),
    ])
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409])
    expect(await userCount()).toBe(1)
  })

  it('AC-8: Better Auth sign-up answers 403 and creates nothing, before and after setup', async () => {
    const { request, setup } = await launch()
    const attempt = () =>
      request('POST', '/api/v1/auth/sign-up/email', {
        payload: { name: 'x', email: 'x@example.test', password },
      })
    expect((await attempt()).statusCode).toBe(403)
    await setup()
    expect((await attempt()).statusCode).toBe(403)
    expect(await userCount()).toBe(1)
  })

  it('AC-9: the session cookie is HttpOnly and SameSite=Lax, Secure over https', async () => {
    const { setup, login, request } = await launch({ trustProxy: 1 })
    await setup()
    const plain = await login('owner.name', password)
    expect(plain.statusCode).toBe(200)
    const cookie = String(plain.headers['set-cookie']).toLowerCase()
    expect(cookie).toContain('httponly')
    expect(cookie).toContain('samesite=lax')
    expect(cookie).not.toContain('secure')

    const overHttps = await request('POST', '/api/v1/auth/sign-in/username', {
      payload: { username: 'owner.name', password },
      headers: { 'x-forwarded-proto': 'https', origin: `https://${host}` },
    })
    expect(overHttps.statusCode).toBe(200)
    expect(String(overHttps.headers['set-cookie']).toLowerCase()).toContain('secure')
    expect(String(overHttps.headers['set-cookie']).toLowerCase()).toContain('httponly')
  })

  it('AC-9: an active session is renewed and the new cookie is passed on', async () => {
    const { setup, request } = await launch()
    const cookie = cookieOf(await setup())
    await database.db.execute(sql`update sessions set expires_at = now() + interval '5 days'`)
    const response = await request('GET', '/api/v1/me', { cookie })
    expect(response.statusCode).toBe(200)
    expect(String(response.headers['set-cookie'])).toContain('better-auth.session_token=')
    const [session] = await database.db.select().from(sessions)
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000)
  })

  it('AC-10: wrong password and unknown username give the same status and code', async () => {
    const { setup, login } = await launch()
    await setup()
    const wrongPassword = await login('owner.name', 'not the password')
    const unknownUsername = await login('nobody', password)
    const malformedUsername = await login('no body@x', password)
    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUsername.statusCode).toBe(401)
    expect(malformedUsername.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(unknownUsername.json())
    expect(wrongPassword.json()).toEqual(malformedUsername.json())
  })

  it('AC-11: the 11th failed login in a minute answers 429', async () => {
    const { setup, login } = await launch()
    await setup()
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await login('owner.name', 'wrong password')).statusCode).toBe(401)
    }
    const blocked = await login('owner.name', password)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ error: { code: 'too_many_attempts' } })
  })

  it('AC-11: a burst of 20 parallel wrong logins lets at most 10 reach the password check', async () => {
    const { setup, login } = await launch()
    await setup()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login('owner.name', 'wrong password')),
    )
    const statuses = results.map((response) => response.statusCode)
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(10)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(10)
  })

  it('AC-11: a spoofed leftmost X-Forwarded-For does not change who is counted, behind one proxy', async () => {
    const { request } = await launch({ trustProxy: 1 })
    const attempt = (forwardedFor: string) =>
      request('POST', '/api/v1/auth/sign-in/username', {
        payload: { username: 'nobody', password: 'wrong password' },
        headers: { 'x-forwarded-for': forwardedFor },
      })
    for (let n = 0; n < 10; n++) {
      expect((await attempt(`198.51.100.${String(n)}, 203.0.113.9`)).statusCode).toBe(401)
    }
    expect((await attempt('198.51.100.99, 203.0.113.9')).statusCode).toBe(429)
    expect((await attempt('198.51.100.99, 203.0.113.10')).statusCode).toBe(401)
  })

  it('AC-11: the global limit answers 429 once a client is past it', async () => {
    const { request } = await launch({ rateLimitMax: 3 })
    for (let n = 0; n < 3; n++) expect((await request('GET', '/api/v1/setup')).statusCode).toBe(200)
    const blocked = await request('GET', '/api/v1/setup')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ error: { code: 'too_many_attempts' } })
  })

  it('AC-12: signing out deletes the session and the old cookie gets 401', async () => {
    const { setup, request } = await launch()
    const cookie = cookieOf(await setup())
    expect(await database.db.select().from(sessions)).toHaveLength(1)

    const out = await request('POST', '/api/v1/auth/sign-out', { cookie })
    expect(out.statusCode).toBe(200)
    expect(await database.db.select().from(sessions)).toHaveLength(0)
    expect((await request('GET', '/api/v1/me', { cookie })).statusCode).toBe(401)
  })

  it('AC-13: every API route except setup and sign-in answers 401 without a session', async () => {
    const { setup, request } = await launch()
    await setup()
    for (const [method, url] of [
      ['GET', '/api/v1/me'],
      ['GET', '/api/v1/auth/get-session'],
      ['POST', '/api/v1/auth/sign-out'],
      ['GET', '/api/v1/entries'],
    ] as const) {
      const response = await request(method, url)
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
    expect((await request('GET', '/api/v1/setup')).statusCode).toBe(200)
    expect((await request('GET', '/healthz')).statusCode).toBe(200)
    expect((await request('GET', '/readyz')).statusCode).toBe(200)
  })

  it('AC-14: the password is stored as an Argon2id hash and nowhere in plain text', async () => {
    const { setup } = await launch()
    await setup()
    const [account] = await database.db.select().from(accounts)
    expect(account?.password).toMatch(/^\$argon2id\$/)
    const dump = JSON.stringify({
      users: await database.db.select().from(users),
      accounts: await database.db.select().from(accounts),
      sessions: await database.db.select().from(sessions),
      settings: await database.db.select().from(instanceSettings),
    })
    expect(dump).not.toContain(password)
  })

  it('AC-16: an empty database logs one 8-character setup code, a database with an account none', async () => {
    const empty = await launch()
    const lines = empty.capture.lines().filter((line) => 'setupCode' in line)
    expect(lines).toHaveLength(1)
    expect(String(lines[0]?.['setupCode'])).toMatch(/^[A-Z2-9]{8}$/)

    await empty.setup()
    const withAccount = await launch()
    expect(withAccount.capture.lines().filter((line) => 'setupCode' in line)).toHaveLength(0)
    expect(withAccount.capture.text()).not.toContain(empty.setupCode)
  })

  it('AC-16: only a hash of the setup code is stored, and it is cleared once the account exists', async () => {
    const { setup, setupCode } = await launch()
    const [before] = await database.db.select().from(instanceSettings)
    expect(before?.setupCodeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(before?.setupCodeHash).not.toContain(setupCode)
    await setup()
    const [after] = await database.db.select().from(instanceSettings)
    expect(after?.setupCodeHash).toBeNull()
  })

  it('AC-17: a missing or wrong setup code answers 403, the right one works', async () => {
    const { setup, request } = await launch()
    const wrong = await setup({}, 'WRONG123')
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json()).toMatchObject({ error: { code: 'invalid_setup_code' } })
    const missing = await request('POST', '/api/v1/setup', { payload: validSetup })
    expect(missing.statusCode).toBe(403)
    expect(await userCount()).toBe(0)
    expect((await setup()).statusCode).toBe(201)
  })

  it('AC-18: the used setup code answers 409 afterwards', async () => {
    const { setup, setupCode } = await launch()
    expect((await setup()).statusCode).toBe(201)
    const again = await setup({ username: 'second' }, setupCode)
    expect(again.statusCode).toBe(409)
    expect(await userCount()).toBe(1)
  })

  it('AC-20: the username is stored in lowercase and login ignores case', async () => {
    const { setup, login } = await launch()
    expect((await setup({ username: '  Owner.Name_1-x ' })).statusCode).toBe(201)
    const [user] = await database.db.select().from(users)
    expect(user?.username).toBe('owner.name_1-x')
    expect((await login('OWNER.NAME_1-X', password)).statusCode).toBe(200)
    expect((await login('owner.name_1-x', password)).statusCode).toBe(200)
  })

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['a space', 'owner name'],
    ['an at sign', 'owner@example.test'],
    ['an accent', 'örs'],
  ])('AC-20: a username that is %s is refused and creates nothing', async (_label, username) => {
    const { setup } = await launch()
    const response = await setup({ username })
    expect(response.statusCode).toBe(400)
    expect(await userCount()).toBe(0)
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(61)],
  ])('AC-20: a name that is %s is refused and creates nothing', async (_label, name) => {
    const { setup } = await launch()
    expect((await setup({ name })).statusCode).toBe(400)
    expect(await userCount()).toBe(0)
  })

  it('AC-20: a name with Hungarian accents is kept as typed', async () => {
    const { setup } = await launch()
    await setup({ name: 'Árvíztűrő Tükörfúrógép' })
    const [user] = await database.db.select().from(users)
    expect(user?.name).toBe('Árvíztűrő Tükörfúrógép')
  })

  it('AC-20: the database refuses a username that is not lowercase', async () => {
    await launch()
    await expect(
      database.db.insert(users).values({ name: 'x', username: 'Owner' }),
    ).rejects.toThrow()
  })

  it('AC-21: no email is stored and the email sign-in route gives no session', async () => {
    const { setup, request } = await launch()
    await setup()
    const [user] = await database.db.select().from(users)
    expect(user?.email).toBeNull()
    const response = await request('POST', '/api/v1/auth/sign-in/email', {
      payload: { email: 'owner@example.test', password },
    })
    expect(response.statusCode).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('AC-22: the migration turns existing accounts into usernames and names', async () => {
    const migration = readFileSync(
      join(import.meta.dirname, '../migrations/0006_username_login.sql'),
      'utf8',
    )
    const backfill = migration
      .split('--> statement-breakpoint')
      .filter((statement) => /^\s*(WITH|UPDATE)/.test(statement))
    const emails = [
      'Owner.Name@Example.test',
      'owner.name@other.test',
      'a@x.test',
      'jó.reggelt@x.test',
      `${'long'.repeat(12)}@x.test`,
    ]
    for (const [index, email] of emails.entries()) {
      await database.db.insert(users).values({
        name: email,
        email,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      })
    }
    for (const statement of backfill) await database.db.execute(sql.raw(statement))
    const rows = await database.db.select().from(users).orderBy(users.createdAt)
    expect(rows.map((row) => row.username)).toEqual([
      'owner.name',
      'owner.name-2',
      'a__',
      'j_.reggelt',
      'long'.repeat(8),
    ])
    expect(rows.map((row) => row.name)).toEqual(rows.map((row) => row.username))
  })

  it('AC-19: marker text from setup, login, wrong password and logout never reaches the logs', async () => {
    const marker = 'ZQX-PRIVATE-7781'
    const { setup, login, request, capture } = await launch()
    const cookie = cookieOf(
      await setup({
        username: `${marker}-user`,
        name: `${marker} Örs`,
        password: marker + 'pw!',
      }),
    )
    await login(`${marker}-user`, `${marker}-wrong`)
    await login(`${marker}-nobody`, marker)
    await request('POST', '/api/v1/auth/sign-in/username', { payload: { username: marker } })
    await request('POST', '/api/v1/auth/sign-out', { cookie })
    await request('GET', `/api/v1/me?q=${marker}`, { cookie })
    expectNoMarkersInLogs(capture, [marker, marker.toLowerCase()])
  })
})
