import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'

describe('API against a real Postgres', () => {
  let postgres: StartedPostgreSqlContainer

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:19').start()
  })

  afterAll(async () => {
    await postgres.stop()
  })

  it('starts a Postgres 19 container that accepts queries', async () => {
    const client = new Client({ connectionString: postgres.getConnectionUri() })
    await client.connect()
    const result = await client.query<{ server_version: string }>('show server_version')
    await client.end()
    expect(result.rows[0]?.server_version).toMatch(/^19/)
  })

  it('answers /healthz through fastify.inject', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
