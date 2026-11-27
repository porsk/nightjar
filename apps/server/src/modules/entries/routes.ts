import {
  createEntrySchema,
  entryResponseSchema,
  timelinePageSchema,
  timelineQuerySchema,
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
import { decodeCursor } from './timeline.ts'
import { listEntries } from './timeline-query.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

const entriesPath = '/api/v1/entries'
const idSchema = z.uuid()

const entryColumns = {
  id: entries.id,
  userId: entries.userId,
  entryDate: entries.entryDate,
  bodyMd: entries.bodyMd,
  createdAt: entries.createdAt,
  updatedAt: entries.updatedAt,
}

type EntryRow = Omit<typeof entries.$inferSelect, 'searchVector'>

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
      .returning(entryColumns)
    if (!row) throw new Error('entry was not created')
    return reply.code(201).send(toEntry(row))
  })

  app.get(entriesPath, async (request) => {
    const user = me(request)
    const parsed = timelineQuerySchema.safeParse(request.query)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const before = parsed.data.before === undefined ? undefined : decodeCursor(parsed.data.before)
    if (before === null) throw new AppError(400, 'invalid_cursor')
    return timelinePageSchema.parse(
      await listEntries(database, user.id, {
        before,
        date: parsed.data.date,
        limit: parsed.data.limit,
      }),
    )
  })

  app.get(`${entriesPath}/:id`, async (request) => {
    const user = me(request)
    const [row] = await db
      .select(entryColumns)
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
      .returning(entryColumns)
    if (!row) throw new AppError(404, 'entry_not_found')
    return toEntry(row)
  })

  app.delete(`${entriesPath}/:id`, async (request, reply) => {
    const user = me(request)
    const id = entryId(request.params)
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(ownedBy(user.id, id))
        .for('update')
      if (!row) throw new AppError(404, 'entry_not_found')
      const files = await tx
        .select({ key: recordings.filePath })
        .from(recordings)
        .where(and(eq(recordings.entryId, id), eq(recordings.userId, user.id)))
      for (const { key } of files) await storage.remove(key)
      await tx.delete(entries).where(ownedBy(user.id, id))
    })
    return reply.code(204).send()
  })
}
