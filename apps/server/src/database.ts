import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'
import * as schema from './db/schema.ts'
import type { Logger } from './logger.ts'

const migrationLockKey = 7_281_977

export function createDatabase(url: string, logger: Logger) {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  })
  pool.on('error', (error: Error & { code?: string }) => {
    logger.warn({ code: error.code }, 'idle database connection failed')
  })

  /** Applies pending migrations in one transaction, under an advisory lock so parallel starts take turns. */
  async function runMigrations(migrationsFolder: string) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 })
    await client.connect()
    try {
      await client.query('select pg_advisory_lock($1)', [migrationLockKey])
      await migrate(drizzle(client), { migrationsFolder })
      await client.query('select pg_advisory_unlock($1)', [migrationLockKey])
    } finally {
      await client.end()
    }
  }

  const db = drizzle(pool, { schema })

  return {
    db,
    ping: async () => {
      await pool.query('select 1')
    },
    migrate: runMigrations,
    close: () => pool.end(),
  }
}

export type Database = ReturnType<typeof createDatabase>
