import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { instanceSettings, users } from '../../db/schema.ts'
import type { Logger } from '../../logger.ts'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const codeLength = 8

const hashCode = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest()

/**
 * The one-time code that proves the person setting up the server can read its log.
 * Only a hash is stored, in the database, so every instance agrees on it.
 * Needs the instance settings row to exist.
 */
export async function issueSetupCode({ db }: Database, logger: Logger) {
  const [row] = await db.select({ total: count() }).from(users)
  if (row?.total !== 0) {
    await db.update(instanceSettings).set({ setupCodeHash: null }).where(eq(instanceSettings.id, 1))
    return
  }
  const code = Array.from({ length: codeLength }, () => alphabet[randomInt(alphabet.length)]).join(
    '',
  )
  await db
    .update(instanceSettings)
    .set({ setupCodeHash: hashCode(code).toString('hex') })
    .where(eq(instanceSettings.id, 1))
  logger.info({ setupCode: code }, 'setup code for the first account')
}

export async function isSetupCode({ db }: Database, candidate: string) {
  const [row] = await db
    .select({ hash: instanceSettings.setupCodeHash })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
  if (!row?.hash) return false
  const expected = Buffer.from(row.hash, 'hex')
  const given = hashCode(candidate)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
