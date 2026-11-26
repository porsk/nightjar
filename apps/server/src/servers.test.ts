import { describe, expect, it } from 'vitest'
import { createDatabase } from './database.ts'
import { createLogger } from './logger.ts'
import { createSetupCode } from './modules/auth/setup-code.ts'
import { createMetrics, startMetricsServer } from './metrics.ts'
import { createReadiness } from './readiness.ts'
import { startWeb } from './web.ts'
import { startWorker } from './worker.ts'
import { captureLogs } from '../test/support/log-capture.ts'

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

describe('web and worker entry points', () => {
  it('the web entry point listens and closes', async () => {
    const logger = createLogger({ level: 'silent' })
    const web = await startWeb(
      {
        logger,
        readiness: createReadiness(() => Promise.resolve()),
        metrics: createMetrics(),
        database: createDatabase('postgres://localhost:1/unused', logger),
        setupCode: createSetupCode(),
      },
      0,
    )
    expect((await fetch(`http://127.0.0.1:${String(web.port)}/healthz`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${String(web.port)}/metrics`)).status).toBe(404)
    await web.close()
  })

  it('the worker entry point starts and stops', async () => {
    const capture = captureLogs()
    const worker = startWorker({ logger: createLogger({ level: 'info', stream: capture.stream }) })
    await worker.stop()
    expect(capture.lines()[0]).toMatchObject({ msg: 'worker started' })
  })
})
