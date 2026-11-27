import { eq } from 'drizzle-orm'
import type { Database } from '../../src/database.ts'
import { accounts, users } from '../../src/db/schema.ts'
import type { Auth } from '../../src/modules/auth/auth.ts'
import { hashPassword } from '../../src/modules/auth/password.ts'

const password = 'correct horse battery'

/** Makes a user straight in the database and signs it in, so tests can have several users. */
export async function createUserWithSession(
  database: Database,
  auth: Auth,
  options: { username: string; timeZone?: string; isAdmin?: boolean },
) {
  const [user] = await database.db
    .insert(users)
    .values({
      name: options.username,
      username: options.username,
      isAdmin: options.isAdmin ?? false,
      timeZone: options.timeZone ?? 'UTC',
    })
    .returning()
  if (!user) throw new Error('user was not created')
  await database.db.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await hashPassword(password),
  })
  const response = await auth.api.signInUsername({
    body: { username: options.username, password },
    asResponse: true,
  })
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ')
  return { id: user.id, cookie }
}

/** Signs in a user that already exists, for tests that restart the server on the same data. */
export async function signInExistingUser(database: Database, auth: Auth, username: string) {
  const [user] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
  if (!user) throw new Error('user does not exist')
  const response = await auth.api.signInUsername({ body: { username, password }, asResponse: true })
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ')
  return { id: user.id, cookie }
}
