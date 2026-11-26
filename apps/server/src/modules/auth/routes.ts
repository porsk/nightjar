import { meResponseSchema, setupRequestSchema, setupStatusSchema, type Me } from '@nightjar/shared'
import { count, eq, sql } from 'drizzle-orm'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Database } from '../../database.ts'
import type { Logger } from '../../logger.ts'
import { accounts, instanceSettings, users } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import { createAuth, authBasePath, type Auth } from './auth.ts'
import { createFailedAttempts } from './failed-attempts.ts'
import { hashPassword } from './password.ts'
import type { SetupCode } from './setup-code.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

declare module 'fastify' {
  interface FastifyRequest {
    me: Me | null
  }
}

const apiPrefix = '/api/v1'
const setupLockKey = 7_281_978
const failedAttemptsLimit = { max: 10, windowMs: 60_000 }

declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean
  }
}

const publicRoute = { config: { public: true } }

const toHeaders = (raw: FastifyRequest['headers']) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'content-length' || value === undefined) continue
    for (const single of Array.isArray(value) ? value : [value]) headers.append(name, single)
  }
  return headers
}

const toMe = (user: {
  id: string
  email: string
  isAdmin?: boolean | null | undefined
  uiLanguage?: string | null | undefined
  entryLanguage?: string | null | undefined
  timeZone?: string | null | undefined
}): Me =>
  meResponseSchema.parse({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    uiLanguage: user.uiLanguage,
    entryLanguage: user.entryLanguage,
    timeZone: user.timeZone,
  })

const authErrorSchema = z.object({ code: z.string(), message: z.string() })

function copyCookies(reply: FastifyReply, response: Response, secure: boolean) {
  const cookies = response.headers.getSetCookie()
  if (cookies.length === 0) return
  reply.header('set-cookie', secure ? cookies.map((cookie) => `${cookie}; Secure`) : cookies)
}

async function sendAuthResponse(reply: FastifyReply, response: Response, secure: boolean) {
  reply.code(response.status)
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie' && name !== 'content-length') reply.header(name, value)
  }
  copyCookies(reply, response, secure)
  const text = await response.text()
  if (response.status < 400) return reply.send(text)
  const parsed = authErrorSchema.safeParse(JSON.parse(text || '{}'))
  const code = parsed.success ? parsed.data.code.toLowerCase() : 'bad_request'
  return reply
    .type('application/json')
    .send({ error: { code, message: 'The request was not accepted' } })
}

export function registerAuthRoutes(
  app: App,
  { database, setupCode }: { database: Database; setupCode: SetupCode },
) {
  const { db } = database
  let auth: Promise<Auth> | undefined
  const getAuth = () => (auth ??= createAuth(database))
  const loginFailures = createFailedAttempts(failedAttemptsLimit)
  const setupFailures = createFailedAttempts(failedAttemptsLimit)

  app.decorateRequest('me', null)

  const accountExists = async () => {
    const [row] = await db.select({ total: count() }).from(users)
    return (row?.total ?? 0) > 0
  }

  const forward = async (request: FastifyRequest, reply: FastifyReply) => {
    const init: RequestInit = { method: request.method, headers: toHeaders(request.headers) }
    if (request.method !== 'GET' && request.body !== undefined) {
      init.body = JSON.stringify(request.body)
    }
    const url = `${request.protocol}://${request.host}${request.url}`
    const response = await (await getAuth()).handler(new Request(url, init))
    return sendAuthResponse(reply, response, request.protocol === 'https')
  }

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith(`${apiPrefix}/`)) return
    if (request.routeOptions.config.public) return
    const session = await (await getAuth()).api.getSession({ headers: toHeaders(request.headers) })
    if (!session) throw new AppError(401, 'unauthorized')
    request.me = toMe(session.user)
  })

  app.get(`${apiPrefix}/setup`, publicRoute, async () =>
    setupStatusSchema.parse({ needed: !(await accountExists()) }),
  )

  app.post(`${apiPrefix}/setup`, publicRoute, async (request, reply) => {
    if (await accountExists()) throw new AppError(409, 'setup_done')
    if (setupFailures.isBlocked(request.ip)) throw new AppError(429, 'too_many_attempts')
    const { setupCode: given } = z
      .object({ setupCode: z.string() })
      .catch({ setupCode: '' })
      .parse(request.body)
    if (!setupCode.matches(given)) {
      setupFailures.record(request.ip)
      throw new AppError(403, 'invalid_setup_code')
    }
    const parsed = setupRequestSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const input = parsed.data
    const email = input.email.toLowerCase()

    const authInstance = await getAuth()
    const password = await hashPassword(input.password)
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${setupLockKey})`)
      const [existing] = await tx.select({ total: count() }).from(users)
      if (existing?.total !== 0) throw new AppError(409, 'setup_done')
      const [created] = await tx
        .insert(users)
        .values({
          name: email.split('@')[0] ?? email,
          email,
          isAdmin: true,
          uiLanguage: input.uiLanguage,
          entryLanguage: input.uiLanguage,
          timeZone: input.timeZone,
        })
        .returning()
      if (!created) throw new Error('user was not created')
      await tx
        .insert(accounts)
        .values({ userId: created.id, accountId: created.id, providerId: 'credential', password })
      await tx
        .update(instanceSettings)
        .set({ transcriptionEnabled: input.transcriptionEnabled })
        .where(eq(instanceSettings.id, 1))
      return created
    })

    const signedIn = await authInstance.api.signInEmail({
      body: { email, password: input.password },
      headers: toHeaders(request.headers),
      asResponse: true,
    })
    if (!signedIn.ok) throw new Error('sign-in after setup failed')
    copyCookies(reply, signedIn, request.protocol === 'https')
    return reply.code(201).send(toMe(user))
  })

  app.post(`${authBasePath}/sign-in/email`, publicRoute, async (request, reply) => {
    if (loginFailures.isBlocked(request.ip)) throw new AppError(429, 'too_many_attempts')
    const result = await forward(request, reply)
    if (reply.statusCode === 401) loginFailures.record(request.ip)
    return result
  })

  app.get(`${authBasePath}/get-session`, forward)
  app.post(`${authBasePath}/sign-out`, forward)
  app.all(`${authBasePath}/sign-up/*`, publicRoute, () => {
    throw new AppError(403, 'signup_disabled')
  })

  app.get(`${apiPrefix}/me`, (request) => request.me)
}
