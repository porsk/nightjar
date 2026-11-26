import fastifyStatic from '@fastify/static'
import Fastify, { LogController } from 'fastify'
import { healthResponseSchema, readyResponseSchema } from '@nightjar/shared'
import type { Logger } from './logger.ts'
import type { Metrics } from './metrics.ts'
import type { Readiness } from './readiness.ts'

export interface AppDependencies {
  logger: Logger
  readiness: Readiness
  metrics: Metrics
  webDir?: string | undefined
}

/** The stack without its first lines, which hold the error message. */
const stackFrames = (error: Error) =>
  (error.stack ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n')

const apiPrefix = '/api/v1'

export function buildApp({ logger, readiness, metrics, webDir }: AppDependencies) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
  })

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]
    const isApi = path === apiPrefix || path?.startsWith(`${apiPrefix}/`)
    if (isApi && !readiness.isMigrated()) {
      return reply
        .code(503)
        .send({ error: { code: 'starting', message: 'The server is starting, try again shortly' } })
    }
    return undefined
  })

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched'
    metrics.httpDuration
      .labels({ method: request.method, route, status_code: reply.statusCode })
      .observe(reply.elapsedTime / 1000)
    request.log.info(
      {
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    )
  })

  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    const code = statusCode >= 500 ? 'internal_error' : (error.code ?? 'bad_request')
    if (statusCode >= 500) {
      request.log.error(
        { code, statusCode, errorName: error.name, stack: stackFrames(error) },
        'request failed',
      )
    } else {
      request.log.warn({ code, statusCode }, 'request failed')
    }
    return reply.code(statusCode).send({
      error: {
        code,
        message: statusCode >= 500 ? 'Internal server error' : 'The request was not accepted',
      },
    })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  )

  app.get('/healthz', () => healthResponseSchema.parse({ status: 'ok' }))

  app.get('/readyz', async (_request, reply) => {
    const status = await readiness.status()
    return reply.code(status === 'ok' ? 200 : 503).send(readyResponseSchema.parse({ status }))
  })

  if (webDir) {
    app.register(fastifyStatic, { root: webDir })
  }

  return app
}
