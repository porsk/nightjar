import Fastify from 'fastify'
import { healthResponseSchema } from '@nightjar/shared'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/healthz', () => healthResponseSchema.parse({ status: 'ok' }))

  return app
}
