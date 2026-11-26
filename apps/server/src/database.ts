import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Logger } from './logger.ts'

const pingTimeoutMs = 2000

const pingTimeout = () =>
  sleep(pingTimeoutMs, undefined, { ref: false }).then(() => {
    throw new Error('database ping timed out')
  })

export function createDatabase(url: string, logger: Logger) {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
  })
  pool.on('error', (error: Error & { code?: string }) => {
    logger.warn({ code: error.code }, 'idle database connection failed')
  })
  const db = drizzle(pool)
  return {
    db,
    ping: async () => {
      await Promise.race([pool.query('select 1'), pingTimeout()])
    },
    /** Applies every pending migration in one transaction. */
    migrate: (migrationsFolder: string) => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  }
}

export type Database = ReturnType<typeof createDatabase>
