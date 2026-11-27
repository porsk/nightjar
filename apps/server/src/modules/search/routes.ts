import { searchResponseSchema } from '@nightjar/shared/search'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '../../database.ts'
import { AppError } from '../../errors.ts'
import type { Logger } from '../../logger.ts'
import { searchEntries } from './query.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

/** A POST with a body, so the words searched for never show up in a URL or an access log. */
const searchBodySchema = z.object({ q: z.string().max(200) })

export function registerSearchRoutes(app: App, { database }: { database: Database }) {
  app.post('/api/v1/search', async (request) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    const parsed = searchBodySchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    return searchResponseSchema.parse(await searchEntries(database, request.me.id, parsed.data.q))
  })
}
