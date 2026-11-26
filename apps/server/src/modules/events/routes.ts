import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { AppError } from '../../errors.ts'
import type { Events } from '../../events.ts'
import type { Logger } from '../../logger.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

const heartbeatMs = 25_000

/** One event stream per browser tab. It only carries events of the signed-in user. */
export function registerEventRoutes(app: App, { events }: { events: Events }) {
  const open = new Set<ServerResponse>()

  app.get('/api/v1/events', (request, reply) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    const { id: userId, isAdmin } = request.me
    reply.hijack()
    const response = reply.raw
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    })
    response.write(': connected\n\n')
    open.add(response)

    const unsubscribe = events.subscribe({
      userId,
      isAdmin,
      send: (event) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
    })
    const heartbeat = setInterval(() => response.write(': ping\n\n'), heartbeatMs)
    request.raw.once('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      open.delete(response)
    })
  })

  app.addHook('onClose', () => {
    for (const response of open) response.end()
  })
}
