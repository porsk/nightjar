import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { expectNoMarkersInLogs } from '../test/support/log-capture.ts'
import { buildTestApp } from '../test/support/test-app.ts'
import { createLogger } from './logger.ts'

const marker = (name: string) => `ZQX-PRIVATE-${name}-7781`

const publicRoute = { config: { public: true } }

function addTestRoutes(app: Awaited<ReturnType<typeof buildTestApp>>['app']) {
  const bodySchema = z.object({ text: z.string().max(5) })
  app.post('/api/v1/test-items', publicRoute, (request) => {
    bodySchema.parse(request.body)
    return { ok: true }
  })
  app.get('/api/v1/test-items/:id', publicRoute, () => ({ ok: true }))
  app.get('/api/v1/test-search', publicRoute, () => ({ hits: [] }))
  app.get('/api/v1/test-crash', publicRoute, (request) => {
    throw new TypeError(`crashed on ${(request.query as { q: string }).q}`)
  })
  app.get('/api/v1/test-explode', publicRoute, (request) => {
    throw Object.assign(new Error(`failed on ${(request.query as { q: string }).q}`), {
      statusCode: 400,
    })
  })
}

describe('007-observability: logs, health, metrics', () => {
  it('AC-1: writes one JSON object per line with level, time, msg and reqId for request lines', async () => {
    const { app, capture } = await buildTestApp()
    await app.inject({ method: 'GET', url: '/healthz' })
    const lines = capture.lines()
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toHaveProperty('level')
      expect(line).toHaveProperty('time')
      expect(line).toHaveProperty('msg')
    }
    const requestLine = lines.find((line) => line['msg'] === 'request completed')
    expect(requestLine?.['reqId']).toBeTypeOf('string')
  })

  it('AC-1: every response carries a fresh UUID x-request-id and incoming ids are ignored', async () => {
    const { app, readiness } = await buildTestApp()
    addTestRoutes(app)
    readiness.markMigrated()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    const ok = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'attacker-chosen' },
    })
    const missing = await app.inject({ method: 'GET', url: '/api/v1/nope' })
    const crashed = await app.inject({ method: 'GET', url: '/api/v1/test-crash?q=x' })
    for (const response of [ok, missing, crashed]) {
      expect(response.headers['x-request-id']).toMatch(uuid)
    }
    expect(crashed.statusCode).toBe(500)
    expect(ok.headers['x-request-id']).not.toBe('attacker-chosen')
  })

  it('AC-1: all log lines of one request share its request id, including errors', async () => {
    const { app, capture, readiness } = await buildTestApp()
    addTestRoutes(app)
    readiness.markMigrated()
    const response = await app.inject({ method: 'GET', url: '/api/v1/test-crash?q=x' })
    const id = response.headers['x-request-id']
    const lines = capture.lines()
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) expect(line['reqId']).toBe(id)
  })

  it('AC-1: hides info lines when the level is warn', async () => {
    const { app, capture } = await buildTestApp({ level: 'warn' })
    await app.inject({ method: 'GET', url: '/healthz' })
    expect(capture.text()).toBe('')
  })

  it('AC-1: redacts sensitive fields if someone logs them by mistake', async () => {
    const { app, capture } = await buildTestApp()
    app.log.info(
      {
        password: 'ZQX-pw',
        email: 'a@b.hu',
        req: { headers: { cookie: 'ZQX-c', authorization: 'ZQX-a' } },
      },
      'oops',
    )
    expectNoMarkersInLogs(capture, ['ZQX-pw', 'a@b.hu', 'ZQX-c', 'ZQX-a'])
    expect(createLogger({ level: 'info' }).level).toBe('info')
  })

  it('AC-2: no marker from body, query, parameter, headers, invalid JSON or error text reaches the logs', async () => {
    const { app, capture, readiness } = await buildTestApp()
    readiness.markMigrated()
    addTestRoutes(app)
    const markers = {
      body: marker('body'),
      query: marker('query'),
      param: marker('param'),
      cookie: marker('cookie'),
      auth: marker('auth'),
      json: marker('json'),
      error: marker('error'),
      path: marker('path'),
    }

    await app.inject({
      method: 'POST',
      url: '/api/v1/test-items',
      payload: { text: markers.body },
    })
    await app.inject({ method: 'GET', url: `/api/v1/test-search?q=${markers.query}` })
    await app.inject({ method: 'GET', url: `/api/v1/test-items/${markers.param}` })
    await app.inject({
      method: 'GET',
      url: '/api/v1/test-search',
      headers: { cookie: `session=${markers.cookie}`, authorization: `Bearer ${markers.auth}` },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/test-items',
      headers: { 'content-type': 'application/json' },
      payload: `{"text": ${markers.json}`,
    })
    await app.inject({ method: 'GET', url: `/api/v1/test-explode?q=${markers.error}` })
    await app.inject({ method: 'GET', url: `/api/v1/test-crash?q=${markers.error}` })
    await app.inject({ method: 'GET', url: `/api/v1/${markers.path}/missing` })

    expectNoMarkersInLogs(capture, Object.values(markers))
  })

  it('AC-3: logs method, route template, status and duration, and nothing else about the request', async () => {
    const { app, capture, readiness } = await buildTestApp()
    readiness.markMigrated()
    addTestRoutes(app)
    const id = randomUUID()
    await app.inject({
      method: 'GET',
      url: `/api/v1/test-items/${id}?q=${marker('query')}`,
      headers: { cookie: 'session=abc', authorization: 'Bearer abc' },
    })
    const line = capture.lines().find((entry) => entry['route'] === '/api/v1/test-items/:id')
    expect(line).toMatchObject({ method: 'GET', route: '/api/v1/test-items/:id', statusCode: 200 })
    expect(line?.['durationMs']).toBeTypeOf('number')
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['durationMs', 'level', 'method', 'msg', 'reqId', 'route', 'statusCode', 'time'].sort(),
    )
    expectNoMarkersInLogs(capture, [id, 'session=abc', 'Bearer abc', marker('query')])
  })

  it('AC-5: reports ok, starting and db_down from the readiness state', async () => {
    let databaseUp = true
    const { app, readiness } = await buildTestApp({
      checkDatabase: () => (databaseUp ? Promise.resolve() : Promise.reject(new Error('down'))),
    })
    expect((await app.inject({ url: '/readyz' })).json()).toEqual({ status: 'starting' })
    readiness.markMigrated()
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200)
    databaseUp = false
    const down = await app.inject({ url: '/readyz' })
    expect(down.statusCode).toBe(503)
    expect(down.json()).toEqual({ status: 'db_down' })
    databaseUp = true
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200)
  })

  it('AC-6: answers /api/v1 with 503 until migrations are done', async () => {
    const { app, readiness } = await buildTestApp()
    addTestRoutes(app)
    const before = await app.inject({ url: '/api/v1/test-search' })
    expect(before.statusCode).toBe(503)
    expect(before.json()).toMatchObject({ error: { code: 'starting' } })
    readiness.markMigrated()
    expect((await app.inject({ url: '/api/v1/test-search' })).statusCode).toBe(200)
  })

  it('AC-8: 50 different ids make one series for the route and no label holds an id', async () => {
    const { app, metrics, readiness } = await buildTestApp()
    readiness.markMigrated()
    addTestRoutes(app)
    const ids = Array.from({ length: 50 }, () => randomUUID())
    for (const id of ids) {
      await app.inject({ method: 'GET', url: `/api/v1/test-items/${id}?q=a@b.hu` })
    }
    await app.inject({ method: 'GET', url: '/no/such/page' })

    const text = await metrics.registry.metrics()
    const counts = text
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_count'))
    const routeSeries = counts.filter((line) => line.includes('route="/api/v1/test-items/:id"'))
    expect(routeSeries).toHaveLength(1)
    expect(routeSeries[0]).toMatch(/ 50$/)
    for (const id of ids) expect(text).not.toContain(id)
    expect(text).not.toContain('a@b.hu')
    const labelValues = [...text.matchAll(/(?:method|route|status_code)="([^"]*)"/g)].map(
      (match) => match[1],
    )
    for (const value of labelValues) expect(value).toMatch(/^[A-Za-z0-9/:_-]*$/)
    expect(counts.some((line) => line.includes('route="unmatched"'))).toBe(true)
  })
})

describe('error responses', () => {
  it('logs the class name and stack frames of a 500, never its message', async () => {
    const { app, capture, readiness } = await buildTestApp()
    readiness.markMigrated()
    addTestRoutes(app)
    const response = await app.inject({ url: `/api/v1/test-crash?q=${marker('crash')}` })
    expect(response.statusCode).toBe(500)
    const line = capture.lines().find((entry) => entry['msg'] === 'request failed')
    expect(line).toMatchObject({ errorName: 'TypeError', code: 'internal_error' })
    expect(line?.['stack']).toContain('at ')
    expectNoMarkersInLogs(capture, [marker('crash')])
  })

  it('answers unknown routes with a JSON 404 that does not echo the URL', async () => {
    const { app } = await buildTestApp()
    const response = await app.inject({ url: `/nothing/${marker('url')}` })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})

describe('serving the web app', () => {
  it('serves files from the web directory when one is given', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'nightjar-web-'))
    writeFileSync(join(webDir, 'index.html'), '<h1>hello</h1>')
    const response = await (await buildTestApp({ webDir })).app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('<h1>hello</h1>')
  })

  it('does not serve the web app without a web directory', async () => {
    const response = await (await buildTestApp()).app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(404)
  })
})
