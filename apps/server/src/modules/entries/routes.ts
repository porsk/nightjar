import {
  createEntrySchema,
  entryResponseSchema,
  todayIn,
  updateEntrySchema,
  type Entry,
} from '@nightjar/shared'
import { and, eq } from 'drizzle-orm'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Database } from '../../database.ts'
import { entries, recordings } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import type { Logger } from '../../logger.ts'
import type { Storage } from '../../storage.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

const entriesPath = '/api/v1/entries'
const idSchema = z.uuid()

type EntryRow = typeof entries.$inferSelect

const toEntry = (row: EntryRow): Entry =>
  entryResponseSchema.parse({
    id: row.id,
    entryDate: row.entryDate,
    bodyMd: row.bodyMd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })

/** Turns a failed validation into the stable error code of the first bad field. */
function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0]
  if (field === 'entryDate') return new AppError(400, 'invalid_entry_date')
  if (field === 'bodyMd' && error.issues[0]?.code === 'too_big') {
    return new AppError(400, 'body_too_long')
  }
  return new AppError(400, 'invalid_request')
}

export function registerEntryRoutes(
  app: App,
  { database, storage, now }: { database: Database; storage: Storage; now: () => Date },
) {
  const { db } = database

  const entryId = (params: unknown) => {
    const parsed = idSchema.safeParse((params as { id?: unknown }).id)
    if (!parsed.success) throw new AppError(404, 'entry_not_found')
    return parsed.data
  }

  const ownedBy = (userId: string, id: string) =>
    and(eq(entries.id, id), eq(entries.userId, userId))

  const checkNotInFuture = (entryDate: string | undefined, timeZone: string) => {
    if (entryDate !== undefined && entryDate > todayIn(timeZone, now())) {
      throw new AppError(400, 'invalid_entry_date')
    }
  }

  const me = (request: FastifyRequest) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    return request.me
  }

  app.post(entriesPath, async (request, reply) => {
    const user = me(request)
    const parsed = createEntrySchema.safeParse(request.body ?? {})
    if (!parsed.success) throw invalidInput(parsed.error)
    checkNotInFuture(parsed.data.entryDate, user.timeZone)
    const [row] = await db
      .insert(entries)
      .values({
        userId: user.id,
        entryDate: parsed.data.entryDate ?? todayIn(user.timeZone, now()),
        bodyMd: parsed.data.bodyMd ?? '',
      })
      .returning()
    if (!row) throw new Error('entry was not created')
    return reply.code(201).send(toEntry(row))
  })

  app.get(`${entriesPath}/:id`, async (request) => {
    const user = me(request)
    const [row] = await db
      .select()
      .from(entries)
      .where(ownedBy(user.id, entryId(request.params)))
    if (!row) throw new AppError(404, 'entry_not_found')
    return toEntry(row)
  })

  app.patch(`${entriesPath}/:id`, async (request) => {
    const user = me(request)
    const id = entryId(request.params)
    const parsed = updateEntrySchema.safeParse(request.body ?? {})
    if (!parsed.success) throw invalidInput(parsed.error)
    checkNotInFuture(parsed.data.entryDate, user.timeZone)
    const [row] = await db
      .update(entries)
      .set({
        updatedAt: new Date(),
        ...(parsed.data.bodyMd !== undefined ? { bodyMd: parsed.data.bodyMd } : {}),
        ...(parsed.data.entryDate !== undefined ? { entryDate: parsed.data.entryDate } : {}),
      })
      .where(ownedBy(user.id, id))
      .returning()
    if (!row) throw new AppError(404, 'entry_not_found')
    return toEntry(row)
  })

  app.delete(`${entriesPath}/:id`, async (request, reply) => {
    const user = me(request)
    const id = entryId(request.params)
    const [row] = await db.select({ id: entries.id }).from(entries).where(ownedBy(user.id, id))
    if (!row) throw new AppError(404, 'entry_not_found')
    const files = await db
      .select({ key: recordings.filePath })
      .from(recordings)
      .where(and(eq(recordings.entryId, id), eq(recordings.userId, user.id)))
    for (const { key } of files) await storage.remove(key)
    await db.delete(entries).where(ownedBy(user.id, id))
    return reply.code(204).send()
  })
}
