import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { createLogger } from '../src/logger.ts'
import { start } from '../src/start.ts'
import { captureLogs, expectNoMarkersInLogs } from './support/log-capture.ts'
import { writeMigrationsFolder } from './support/migrations.ts'
import { startPostgres } from './support/postgres.ts'

const once = <T>(run: () => Promise<T>) => {
  let pending: Promise<T> | undefined
  return () => (pending ??= run())
}

const usersTable =
  'create table users (id uuid); create table instance_settings (id int primary key, transcription_enabled boolean not null default false, auth_secret text not null, setup_code_hash text, updated_at timestamptz not null default now());'
const shippedMigrations = join(import.meta.dirname, '../migrations')

describe('007-observability: health, migrations and metrics against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer
  const running: { close: () => Promise<void> }[] = []

  beforeAll(async () => {
    postgres = await startPostgres()
  })

  afterAll(async () => {
    for (const server of running) await server.close()
    await postgres.stop()
  })

  async function database(name: string) {
    await vi.waitFor(
      async () => {
        const admin = new Client({ connectionString: postgres.getConnectionUri() })
        await admin.connect()
        try {
          await admin.query(`create database ${name}`)
        } finally {
          await admin.end()
        }
      },
      { timeout: 30_000, interval: 500 },
    )
    const url = new URL(postgres.getConnectionUri())
    url.pathname = `/${name}`
    return url.toString()
  }

  async function query<T extends object>(url: string, sql: string): Promise<T[]> {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      return (await client.query<T>(sql)).rows
    } finally {
      await client.end()
    }
  }

  async function launch(
    url: string,
    options: { migrationsFolder?: string; exit?: (code: number) => void } = {},
  ) {
    const capture = captureLogs()
    const config = loadConfig({ DATABASE_URL: url, PORT: '0', NIGHTJAR_METRICS_PORT: '0' })
    const server = await start({
      config,
      logger: createLogger({ level: 'info', stream: capture.stream }),
      migrationsFolder: options.migrationsFolder ?? shippedMigrations,
      exit: options.exit ?? (() => undefined),
    })
    const close = once(server.close)
    running.push({ close })
    return { ...server, close, capture, config }
  }

  const get = (port: number, path: string) => fetch(`http://127.0.0.1:${String(port)}${path}`)

  it('AC-4: /healthz answers 200 ok without auth, even while the database is down', async () => {
    const server = await launch(await database('ac4'))
    await server.ready
    execFileSync('docker', ['stop', postgres.getId()])
    try {
      const response = await get(server.appPort, '/healthz')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    } finally {
      execFileSync('docker', ['start', postgres.getId()])
    }
  })

  it('AC-5: /readyz is 200, then 503 db_down when the database stops, then 200 again without a restart', async () => {
    const server = await launch(await database('ac5'))
    await server.ready
    expect((await get(server.appPort, '/readyz')).status).toBe(200)

    execFileSync('docker', ['stop', postgres.getId()])
    const down = await get(server.appPort, '/readyz')
    expect(down.status).toBe(503)
    expect(await down.json()).toEqual({ status: 'db_down' })

    execFileSync('docker', ['start', postgres.getId()])
    await vi.waitFor(
      async () => {
        expect((await get(server.appPort, '/readyz')).status).toBe(200)
      },
      {
        timeout: 30_000,
        interval: 500,
      },
    )
  })

  it('AC-5: /readyz answers 503 starting and /api/v1 answers 503 while migrations run', async () => {
    const url = await database('ac5_starting')
    const slow = writeMigrationsFolder([`select pg_sleep(3); ${usersTable}`])
    const server = await launch(url, { migrationsFolder: slow })
    const readyz = await get(server.appPort, '/readyz')
    expect(readyz.status).toBe(503)
    expect(await readyz.json()).toEqual({ status: 'starting' })
    expect((await get(server.appPort, '/api/v1/anything')).status).toBe(503)
    await server.ready
    expect((await get(server.appPort, '/readyz')).status).toBe(200)
  })

  it('AC-6: applies migrations on an empty database, and a second start applies nothing', async () => {
    const url = await database('ac6')
    const folder = writeMigrationsFolder([`create table first_table (id int); ${usersTable}`])
    const first = await launch(url, { migrationsFolder: folder })
    await first.ready
    const applied = () => query<{ id: number }>(url, 'select id from drizzle.__drizzle_migrations')
    expect(await applied()).toHaveLength(1)
    await first.close()

    const second = await launch(url, { migrationsFolder: folder })
    await second.ready
    expect(await applied()).toHaveLength(1)
    expect(second.capture.text()).toContain('migrations done')
  })

  it('AC-6: two parallel starts apply the migration once and both become ready', async () => {
    const url = await database('ac6_parallel')
    const folder = writeMigrationsFolder([
      `create table once_only (id int); ${usersTable} select pg_sleep(1);`,
    ])
    const exit = vi.fn()
    const [first, second] = await Promise.all([
      launch(url, { migrationsFolder: folder, exit }),
      launch(url, { migrationsFolder: folder, exit }),
    ])
    await Promise.all([first.ready, second.ready])
    expect(exit).not.toHaveBeenCalled()
    expect(await query(url, 'select id from drizzle.__drizzle_migrations')).toHaveLength(1)
    expect((await get(first.appPort, '/readyz')).status).toBe(200)
    expect((await get(second.appPort, '/readyz')).status).toBe(200)
  })

  it('AC-6: the shipped migrations apply cleanly', async () => {
    const url = await database('ac6_shipped')
    const server = await launch(url)
    await server.ready
    expect((await get(server.appPort, '/readyz')).status).toBe(200)
  })

  it('AC-6: a failing migration leaves no partial change, logs the error and exits non-zero', async () => {
    const url = await database('ac6_broken')
    const folder = writeMigrationsFolder([
      'create table kept_out (id int);',
      'select * from table_that_does_not_exist;',
    ])
    const exit = vi.fn()
    const server = await launch(url, { migrationsFolder: folder, exit })
    await server.ready
    expect(exit).toHaveBeenCalledWith(1)
    const tables = await query<{ tablename: string }>(
      url,
      "select tablename from pg_tables where tablename = 'kept_out'",
    )
    expect(tables).toHaveLength(0)
    const errorLine = server.capture.lines().find((line) => line['level'] === 'error')
    expect(errorLine?.['msg']).toBe('migrations failed')
    expect((await get(server.appPort, '/readyz')).status).toBe(503)
  })

  it('AC-9: /metrics is 404 on the app port; the metrics port serves only /metrics', async () => {
    const server = await launch(await database('ac9'))
    await server.ready
    expect((await get(server.appPort, '/metrics')).status).toBe(404)
    expect(server.metricsPort).not.toBe(server.appPort)
    const metrics = await get(server.metricsPort, '/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.headers.get('content-type')).toContain('text/plain')
    expect((await get(server.metricsPort, '/healthz')).status).toBe(404)
    expect((await get(server.metricsPort, '/')).status).toBe(404)
  })

  it('AC-1: the running server logs only JSON lines, and none carry the database password', async () => {
    const server = await launch(await database('ac1'))
    await server.ready
    await get(server.appPort, '/healthz')
    for (const line of server.capture.lines()) expect(line).toHaveProperty('level')
    expectNoMarkersInLogs(server.capture, [new URL(postgres.getConnectionUri()).password])
  })
})
