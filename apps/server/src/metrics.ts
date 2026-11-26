import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client'

export function createMetrics() {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  })
  return { registry, httpDuration }
}

export type Metrics = ReturnType<typeof createMetrics>

/** Serves `/metrics` and nothing else, on its own port. */
export async function startMetricsServer(metrics: Metrics, port: number) {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/metrics') {
      response.writeHead(404).end()
      return
    }
    metrics.registry.metrics().then(
      (body) => response.writeHead(200, { 'content-type': metrics.registry.contentType }).end(body),
      () => response.writeHead(500).end(),
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}
