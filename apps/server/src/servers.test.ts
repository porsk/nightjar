import { describe, expect, it } from 'vitest'
import { createDatabase } from './database.ts'
import { createLogger } from './logger.ts'
import { createMetrics, startMetricsServer } from './metrics.ts'
import { createReadiness } from './readiness.ts'
import { createStorage } from './storage.ts'
import { startWeb } from './web.ts'
import { inertEvents, inertTranscription } from '../test/support/test-app.ts'

describe('metrics server', () => {
  it('serves Prometheus text on /metrics only', async () => {
    const server = await startMetricsServer(createMetrics(), 0)
    const base = `http://127.0.0.1:${String(server.port)}`
    const metrics = await fetch(`${base}/metrics`)
    expect(metrics.status).toBe(200)
    expect(await metrics.text()).toContain('process_cpu_user_seconds_total')
    expect((await fetch(`${base}/`)).status).toBe(404)
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404)
    await server.close()
  })
})

describe('web entry point', () => {
  it('it listens and closes', async () => {
    const logger = createLogger({ level: 'silent' })
    const web = await startWeb(
      {
        logger,
        readiness: createReadiness(() => Promise.resolve()),
        metrics: createMetrics(),
        database: createDatabase('postgres://localhost:1/unused', logger),
        storage: createStorage('/unused'),
        events: inertEvents,
        transcription: inertTranscription,
        getAuth: () => {
          throw new Error('no auth')
        },
      },
      0,
    )
    expect((await fetch(`http://127.0.0.1:${String(web.port)}/healthz`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${String(web.port)}/metrics`)).status).toBe(404)
    await web.close()
  })
})
