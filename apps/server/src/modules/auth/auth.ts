import { randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { username } from 'better-auth/plugins'
import { usernameMaxLength, usernameMinLength, usernamePattern } from '@nightjar/shared'
import { eq } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { accounts, instanceSettings, sessions, users, verifications } from '../../db/schema.ts'
import { hashPassword, verifyPassword } from './password.ts'

export const authBasePath = '/api/v1/auth'

/** The signing secret is made once and kept in the database, so the install needs no setup for it. */
async function loadAuthSecret({ db }: Database) {
  await db
    .insert(instanceSettings)
    .values({ id: 1, authSecret: randomBytes(32).toString('hex') })
    .onConflictDoNothing()
  const [row] = await db
    .select({ secret: instanceSettings.authSecret })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
  if (!row) throw new Error('instance settings row is missing')
  return row.secret
}

export async function createAuth(database: Database) {
  return betterAuth({
    basePath: authBasePath,
    secret: await loadAuthSecret(database),
    database: drizzleAdapter(database.db, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    plugins: [
      username({
        displayUsername: false,
        minUsernameLength: usernameMinLength,
        maxUsernameLength: usernameMaxLength,
        usernameValidator: (value) => usernamePattern.test(value),
      }),
    ],
    user: {
      additionalFields: {
        isAdmin: { type: 'boolean', input: false },
        uiLanguage: { type: 'string', input: false },
        entryLanguage: { type: 'string', input: false },
        timeZone: { type: 'string', input: false },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: false,
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    telemetry: { enabled: false },
  })
}

export type Auth = Awaited<ReturnType<typeof createAuth>>
