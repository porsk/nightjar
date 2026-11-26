import { randomInt, timingSafeEqual } from 'node:crypto'
import { count } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { users } from '../../db/schema.ts'
import type { Logger } from '../../logger.ts'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const codeLength = 8

/** The one-time code that proves the person setting up the server can read its log. */
export function createSetupCode() {
  let code: string | undefined

  return {
    /** Prints a fresh code to the log, but only while no account exists. */
    async issueIfNoAccount(database: Database, logger: Logger) {
      const [row] = await database.db.select({ total: count() }).from(users)
      if (row?.total !== 0) return
      code = Array.from({ length: codeLength }, () => alphabet[randomInt(alphabet.length)]).join('')
      logger.info({ setupCode: code }, 'setup code for the first account')
    },
    matches(candidate: string) {
      if (code === undefined) return false
      const expected = Buffer.from(code)
      const given = Buffer.from(candidate.trim().toUpperCase())
      return expected.length === given.length && timingSafeEqual(expected, given)
    },
  }
}

export type SetupCode = ReturnType<typeof createSetupCode>
