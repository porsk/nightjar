import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { healthResponseSchema } from '@nightjar/shared'

export function buildApp(options: { webDir?: string } = {}) {
  const app = Fastify({ logger: true })

  app.get('/healthz', () => healthResponseSchema.parse({ status: 'ok' }))

  if (options.webDir) {
    app.register(fastifyStatic, { root: options.webDir })
  }

  return app
}
