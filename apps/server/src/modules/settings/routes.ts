import { isTimeZone, settingsPatchSchema } from '@nightjar/shared'
import { eq } from 'drizzle-orm'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import type { Database } from '../../database.ts'
import type { Logger } from '../../logger.ts'
import { users } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import { toMe } from '../auth/routes.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

export function registerSettingsRoutes(app: App, { database }: { database: Database }) {
  const { db } = database

  app.patch('/api/v1/me/settings', async (request) => {
    const me = request.me
    if (!me) throw new AppError(401, 'unauthorized')
    const parsed = settingsPatchSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const { timeZone } = parsed.data
    if (timeZone !== undefined && !isTimeZone(timeZone)) {
      throw new AppError(400, 'invalid_time_zone')
    }
    const [updated] = await db.update(users).set(parsed.data).where(eq(users.id, me.id)).returning()
    if (!updated) throw new AppError(401, 'unauthorized')
    return toMe(updated)
  })
}
