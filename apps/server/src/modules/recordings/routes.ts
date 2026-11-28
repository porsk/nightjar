import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import { entryDateSchema, entryLanguageSchema, todayIn } from '@nightjar/shared'
import {
  maxRecordingMs,
  maxUploadBytes as defaultMaxUploadBytes,
  recordingSchema,
  recordingsResponseSchema,
  retranscribeSchema,
  updateTranscriptSchema,
  type Recording,
  type RecordingStatus,
  type Transcript,
} from '@nightjar/shared/recordings'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { UnreadableAudioError, measureDurationMs } from '../../audio/ffmpeg.ts'
import { ffmpegFormatFor, sniffAudio, sniffLength } from '../../audio/sniff.ts'
import type { Database } from '../../database.ts'
import { entries, recordings, transcripts } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import type { Events } from '../../events.ts'
import type { Logger } from '../../logger.ts'
import { recordingKey, type Storage } from '../../storage.ts'
import type { TranscriptionService } from '../transcription/service.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

interface Dependencies {
  database: Database
  storage: Storage
  events: Events
  transcription: Pick<TranscriptionService, 'initialStatus' | 'schedule' | 'availability'>
  now: () => Date
  maxUploadBytes?: number | undefined
}

const idSchema = z.uuid()

const uploadFieldsSchema = z.object({
  language: entryLanguageSchema,
  entryId: z.uuid().optional(),
  entryDate: entryDateSchema.optional(),
})

type RecordingRow = typeof recordings.$inferSelect
type TranscriptRow = typeof transcripts.$inferSelect

const toTranscript = (row: TranscriptRow): Transcript => ({
  text: row.text,
  language: row.language,
  model: row.model,
  isUserEdited: row.isUserEdited,
  updatedAt: row.updatedAt.toISOString(),
})

const toRecording = (row: RecordingRow, transcript: TranscriptRow | null | undefined): Recording =>
  recordingSchema.parse({
    id: row.id,
    entryId: row.entryId,
    status: row.status,
    durationMs: row.durationMs,
    mimeType: row.mimeType,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    transcript: transcript ? toTranscript(transcript) : null,
  })

/** Writes the upload to disk and remembers its size and first bytes, so the format can be checked by content. */
async function writeUpload(source: Readable, path: string) {
  let head = Buffer.alloc(0)
  let size = 0
  const watcher = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (head.length < sniffLength) {
        head = Buffer.concat([head, chunk.subarray(0, sniffLength - head.length)])
      }
      done(null, chunk)
    },
  })
  await pipeline(source, watcher, createWriteStream(path))
  return { size, kind: sniffAudio(head) }
}

/** Reads `bytes=a-b`, `bytes=a-` or `bytes=-n`. Anything else is ignored and the whole file is sent. */
function parseRange(header: string | undefined, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (match[1] === '' && match[2] === '')) return undefined
  const [first = '', last = ''] = [match[1], match[2]]
  const start = first === '' ? Math.max(0, size - Number(last)) : Number(first)
  const end = first === '' || last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return start <= end && start < size ? { start, end } : 'unsatisfiable'
}

export function registerRecordingRoutes(
  app: App,
  { database, storage, events, transcription, now, maxUploadBytes }: Dependencies,
) {
  const { db } = database

  void app.register(multipart, {
    limits: {
      fileSize: maxUploadBytes ?? defaultMaxUploadBytes,
      files: 1,
      fields: 8,
      fieldSize: 256,
    },
    throwFileSizeLimit: false,
  })

  const me = (request: FastifyRequest) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    return request.me
  }

  const idParam = (request: FastifyRequest, code: string) => {
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id)
    if (!parsed.success) throw new AppError(404, code)
    return parsed.data
  }

  const findOwned = async (userId: string, id: string) => {
    const [row] = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.userId, userId)))
    if (!row) throw new AppError(404, 'recording_not_found')
    return row
  }

  const announce = (
    row: { userId: string; entryId: string; id: string },
    status: RecordingStatus,
  ) =>
    events.publishToUser(row.userId, {
      type: 'recording.updated',
      entryId: row.entryId,
      recordingId: row.id,
      status,
    })

  app.post('/api/v1/recordings', async (request, reply) => {
    const user = me(request)
    if (!request.isMultipart()) throw new AppError(400, 'invalid_request')
    const upload = await storage.tempFile('upload')
    const recordingId = randomUUID()
    let storedKey: string | undefined
    try {
      const fields: Record<string, string> = {}
      let received: Awaited<ReturnType<typeof writeUpload>> | undefined
      let tooLarge = false
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (typeof part.value === 'string') fields[part.fieldname] = part.value
        } else if (received) {
          part.file.resume()
        } else {
          received = await writeUpload(part.file, upload.path)
          tooLarge = part.file.truncated
        }
      }
      if (tooLarge) throw new AppError(413, 'file_too_large')
      if (!received?.kind) throw new AppError(415, 'unsupported_audio')

      const parsed = uploadFieldsSchema.safeParse(fields)
      if (
        !parsed.success ||
        (parsed.data.entryId === undefined) === (parsed.data.entryDate === undefined)
      ) {
        throw new AppError(400, 'invalid_request')
      }
      const { language, entryId, entryDate } = parsed.data
      if (entryDate !== undefined && entryDate > todayIn(user.timeZone, now())) {
        throw new AppError(400, 'invalid_entry_date')
      }
      if (entryId !== undefined) {
        const [entry] = await db
          .select({ id: entries.id })
          .from(entries)
          .where(and(eq(entries.id, entryId), eq(entries.userId, user.id)))
        if (!entry) throw new AppError(404, 'entry_not_found')
      }

      const durationMs = await measureDurationMs(
        upload.path,
        ffmpegFormatFor(received.kind.extension) ?? '',
      ).catch((error: unknown) => {
        if (error instanceof UnreadableAudioError) throw new AppError(415, 'unsupported_audio')
        throw error
      })

      if (durationMs > maxRecordingMs) throw new AppError(413, 'recording_too_long')

      const key = recordingKey(user.id, recordingId, received.kind.extension)
      await storage.adopt(upload.path, key)
      storedKey = key
      const status = await transcription.initialStatus()
      const row = await db.transaction(async (tx) => {
        let targetEntry = entryId
        if (targetEntry === undefined) {
          const [created] = await tx
            .insert(entries)
            .values({ userId: user.id, entryDate: entryDate ?? todayIn(user.timeZone, now()) })
            .returning({ id: entries.id })
          if (!created) throw new Error('entry was not created')
          targetEntry = created.id
        }
        const [saved] = await tx
          .insert(recordings)
          .values({
            id: recordingId,
            userId: user.id,
            entryId: targetEntry,
            filePath: key,
            mimeType: received.kind?.mimeType ?? '',
            sizeBytes: received.size,
            durationMs,
            language,
            status,
          })
          .returning()
        if (!saved) throw new Error('recording was not saved')
        return saved
      })
      storedKey = undefined

      await announce(row, status)
      await transcription.schedule(row, request.id)
      return await reply.code(201).send(toRecording(row, null))
    } finally {
      await upload.remove()
      if (storedKey) await storage.remove(storedKey)
    }
  })

  app.get('/api/v1/recordings/:id/audio', async (request, reply) => {
    const row = await findOwned(me(request).id, idParam(request, 'recording_not_found'))
    const size = await storage.size(row.filePath)
    if (size === undefined) throw new AppError(404, 'recording_not_found')
    reply.header('content-type', row.mimeType).header('accept-ranges', 'bytes')
    reply.header('cache-control', 'private, no-store')

    const range = parseRange(request.headers.range, size)
    if (range === 'unsatisfiable') {
      return reply
        .code(416)
        .header('content-range', `bytes */${String(size)}`)
        .send()
    }
    if (!range) {
      return reply.header('content-length', size).send(storage.read(row.filePath))
    }
    return reply
      .code(206)
      .header('content-range', `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`)
      .header('content-length', range.end - range.start + 1)
      .send(storage.read(row.filePath, range))
  })

  app.patch('/api/v1/recordings/:id/transcript', async (request) => {
    const user = me(request)
    const id = idParam(request, 'recording_not_found')
    const parsed = updateTranscriptSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const [row] = await db
      .update(transcripts)
      .set({ text: parsed.data.text, isUserEdited: true })
      .where(and(eq(transcripts.recordingId, id), eq(transcripts.userId, user.id)))
      .returning()
    if (!row) throw new AppError(404, 'recording_not_found')
    await db.update(recordings).set({ replaceEdited: false }).where(eq(recordings.id, id))
    return toTranscript(row)
  })

  app.post('/api/v1/recordings/:id/retry', async (request) => {
    const user = me(request)
    const row = await findOwned(user.id, idParam(request, 'recording_not_found'))
    // a recording stuck in `transcribing` after a crash can be retried too
    if (!['failed', 'transcribing', 'pending'].includes(row.status)) {
      throw new AppError(409, 'not_failed')
    }
    const status = await transcription.initialStatus()
    const [updated] = await db
      .update(recordings)
      .set({ status })
      .where(eq(recordings.id, row.id))
      .returning()
    if (!updated) throw new AppError(404, 'recording_not_found')
    await announce(updated, status)
    await transcription.schedule(updated, request.id)
    return toRecording(updated, null)
  })

  app.post('/api/v1/recordings/:id/retranscribe', async (request) => {
    const user = me(request)
    const row = await findOwned(user.id, idParam(request, 'recording_not_found'))
    const parsed = retranscribeSchema.safeParse(request.body ?? {})
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const replaceEdited = parsed.data.replaceEdited === true
    if ((await transcription.availability()).state !== 'ready') {
      throw new AppError(409, 'model_not_ready')
    }
    if (row.status === 'pending' || row.status === 'transcribing') {
      throw new AppError(409, 'already_transcribing')
    }
    const [transcript] = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.recordingId, row.id))
    if (transcript?.isUserEdited && !replaceEdited) throw new AppError(409, 'transcript_edited')
    const [updated] = await db
      .update(recordings)
      .set({ status: 'pending', replaceEdited })
      .where(
        and(eq(recordings.id, row.id), inArray(recordings.status, ['done', 'failed', 'skipped'])),
      )
      .returning()
    if (!updated) throw new AppError(409, 'already_transcribing')
    await announce(updated, 'pending')
    await transcription.schedule(updated, request.id, replaceEdited)
    return toRecording(updated, transcript)
  })

  app.get('/api/v1/entries/:id/recordings', async (request) => {
    const user = me(request)
    const entryId = idParam(request, 'entry_not_found')
    const [entry] = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.userId, user.id)))
    if (!entry) throw new AppError(404, 'entry_not_found')
    const rows = await db
      .select({ recording: recordings, transcript: transcripts })
      .from(recordings)
      .leftJoin(transcripts, eq(transcripts.recordingId, recordings.id))
      .where(and(eq(recordings.entryId, entryId), eq(recordings.userId, user.id)))
      .orderBy(asc(recordings.createdAt), asc(recordings.id))
    return recordingsResponseSchema.parse(
      rows.map((row) => toRecording(row.recording, row.transcript)),
    )
  })
}
