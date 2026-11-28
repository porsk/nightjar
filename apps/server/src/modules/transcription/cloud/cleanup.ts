import { eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../../database.ts'
import { cloudCopies, recordings } from '../../../db/schema.ts'
import type { CleanupJob } from '../../../jobs.ts'
import type { Logger } from '../../../logger.ts'
import { ProviderError, type CloudProvider } from './provider.ts'
import { providerById } from './registry.ts'
import type { KeyStore } from './key-store.ts'

/** The longest one delete may take, all of a copy's calls together. */
const removeLimitMs = 2 * 60_000

type CopyRow = typeof cloudCopies.$inferSelect

/** A short code for the log: the HTTP status, `network`, or the failure code. Never a message or a body. */
export function reasonOf(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.httpStatus !== undefined) return `http_${String(error.httpStatus)}`
    return error.code === 'provider_unavailable' ? 'network' : error.code
  }
  return 'error'
}

interface Dependencies {
  database: Database
  keys: KeyStore
  providers: readonly CloudProvider[]
  logger: Logger
  fetch: typeof fetch
  /** Copies younger than this are left alone, so a job that is still working is not disturbed. */
  minAgeMs?: number
  now?: () => Date
}

/** Deletes vendor copies listed in `cloud_copies` and removes the rows that were deleted. */
export function createCopyCleaner({
  database,
  keys,
  providers,
  logger,
  fetch: fetchFn,
  minAgeMs = 60_000,
  now = () => new Date(),
}: Dependencies) {
  const { db } = database

  /** Tries every row once. Returns how many are still there. */
  async function removeRows(rows: readonly CopyRow[]): Promise<number> {
    let left = 0
    for (const row of rows) {
      const provider = providerById(providers, row.providerId)
      const saved = provider ? await keys.read(provider.id) : undefined
      if (!provider || saved?.state !== 'ready') {
        logger.warn(
          { provider: row.providerId, reason: 'api_key_missing' },
          'provider cleanup failed',
        )
        left++
        continue
      }
      try {
        const outcome = await provider.remove(
          { secrets: saved.secrets, fetch: fetchFn, signal: AbortSignal.timeout(removeLimitMs) },
          row.vendorRef,
        )
        if (outcome === 'no_delete_api') {
          logger.warn({ provider: provider.id, reason: outcome }, 'provider copy cannot be deleted')
        }
        await db.delete(cloudCopies).where(eq(cloudCopies.id, row.id))
      } catch (error) {
        logger.warn({ provider: provider.id, reason: reasonOf(error) }, 'provider cleanup failed')
        left++
      }
    }
    return left
  }

  const forRecording = (recordingId: string) =>
    db.select().from(cloudCopies).where(eq(cloudCopies.recordingId, recordingId))

  const byIds = (ids: readonly string[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(cloudCopies)
          .where(inArray(cloudCopies.id, [...ids]))

  /** Rows whose recording is not being transcribed right now (or is gone), split by whether they are old enough. */
  async function idle(): Promise<{ due: CopyRow[]; young: CopyRow[] }> {
    const cutoff = now().getTime() - minAgeMs
    const rows = await db
      .select({ copy: cloudCopies })
      .from(cloudCopies)
      .leftJoin(recordings, eq(recordings.id, cloudCopies.recordingId))
      .where(or(isNull(recordings.id), sql`${recordings.status} <> 'transcribing'`))
    const copies = rows.map((row) => row.copy)
    return {
      due: copies.filter((copy) => copy.createdAt.getTime() < cutoff),
      young: copies.filter((copy) => copy.createdAt.getTime() >= cutoff),
    }
  }

  return {
    removeRows,
    forRecording,
    byIds,
    /**
     * One cleanup run. Returns how many copies are still there: those that could not be deleted and those
     * still too young to touch, so the job fails and the queue tries again later.
     */
    run: async () => {
      const { due, young } = await idle()
      return (await removeRows(due)) + young.length
    },
  }
}

export type CopyCleaner = ReturnType<typeof createCopyCleaner>

/** The `cloud-cleanup` job: fails while copies are left, so the queue retries, and says so when it gives up. */
export function createCleanupHandler({
  cleaner,
  logger,
}: {
  cleaner: CopyCleaner
  logger: Logger
}) {
  return async (job: CleanupJob) => {
    const left = await cleaner.run()
    if (left === 0) return
    if (job.retryCount >= job.retryLimit) {
      logger.warn({ left }, 'provider cleanup gave up')
      return
    }
    throw new Error('provider copies are left')
  }
}
