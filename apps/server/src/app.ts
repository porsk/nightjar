import { randomUUID } from 'node:crypto'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { LogController } from 'fastify'
import { healthResponseSchema, readyResponseSchema } from '@nightjar/shared'
import type { Database } from './database.ts'
import { AppError } from './errors.ts'
import type { Logger } from './logger.ts'
import type { Metrics } from './metrics.ts'
import type { Auth } from './modules/auth/auth.ts'
import { registerAuthRoutes } from './modules/auth/routes.ts'
import { registerSettingsRoutes } from './modules/settings/routes.ts'
import { registerEntryRoutes } from './modules/entries/routes.ts'
import type { Readiness } from './readiness.ts'
import type { Storage } from './storage.ts'

export interface AppDependencies {
  logger: Logger
  readiness: Readiness
  metrics: Metrics
  database: Database
  storage: Storage
  /** The current time. Tests pass a fixed clock. */
  now?: (() => Date) | undefined
  /** Returns the auth instance, which exists once migrations are done. */
  getAuth: () => Auth
  /** Number of reverse proxies in front of the server. 0 trusts no forwarded headers. */
  trustProxy?: number | undefined
  rateLimitMax?: number | undefined
  webDir?: string | undefined
}

/** The stack without its first lines, which hold the error message. */
const stackFrames = (error: Error) =>
  (error.stack ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n')

const apiPrefix = '/api/v1'

export async function buildApp({
  logger,
  readiness,
  metrics,
  database,
  storage,
  now,
  getAuth,
  trustProxy,
  rateLimitMax,
  webDir,
}: AppDependencies) {
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    trustProxy: (_address: string, hop: number) => hop < (trustProxy ?? 0),
    logController: new LogController({ disableRequestLogging: true }),
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
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

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
  await app.register(rateLimit, {
    max: rateLimitMax ?? 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError(429, 'too_many_attempts'),
  })
  registerAuthRoutes(app, { database, getAuth })
  registerSettingsRoutes(app, { database })
  registerEntryRoutes(app, { database, storage, now: now ?? (() => new Date()) })

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

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.split('?')[0]?.startsWith(`${apiPrefix}/`)
    if (webDir && request.method === 'GET' && !isApi) return reply.sendFile('index.html')
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
  })

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
