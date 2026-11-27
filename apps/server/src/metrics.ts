import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client'

export function createMetrics() {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  })
  const jobDuration = new Histogram({
    name: 'nightjar_job_duration_seconds',
    help: 'Background job duration in seconds',
    labelNames: ['queue', 'outcome'],
    buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600, 1800],
    registers: [registry],
  })
  const transcriptionRtf = new Histogram({
    name: 'nightjar_transcription_rtf',
    help: 'Transcription time divided by audio length (real-time factor)',
    labelNames: ['model'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
    registers: [registry],
  })
  const queueDepthSource = { read: () => Promise.resolve<Record<string, number>>({}) }
  new Gauge({
    name: 'nightjar_queue_depth',
    help: 'Jobs waiting in a queue',
    labelNames: ['queue'],
    registers: [registry],
    async collect() {
      for (const [queue, depth] of Object.entries(await queueDepthSource.read())) {
        this.set({ queue }, depth)
      }
    },
  })
  return {
    registry,
    httpDuration,
    jobDuration,
    transcriptionRtf,
    /** The worker tells the gauge where to read queue lengths from. */
    setQueueDepthSource: (read: () => Promise<Record<string, number>>) => {
      queueDepthSource.read = read
    },
  }
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
