import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  keyTestResultSchema,
  providerSecretsSchema,
  setTranscriptionSchema,
  transcriptionAvailabilitySchema,
  transcriptionStatusSchema,
} from '@nightjar/shared/recordings'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppError } from '../../errors.ts'
import type { Logger } from '../../logger.ts'
import type { CloudProvider } from './cloud/provider.ts'
import { providerById } from './cloud/registry.ts'
import type { TranscriptionService } from './service.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

const path = '/api/v1/admin/transcription'

const testBodySchema = z.strictObject({ apiKey: providerSecretsSchema.shape.apiKey.optional() })

export function registerTranscriptionRoutes(
  app: App,
  {
    transcription,
    providers,
  }: { transcription: TranscriptionService; providers: readonly CloudProvider[] },
) {
  const admin = (request: FastifyRequest) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    if (!request.me.isAdmin) throw new AppError(403, 'forbidden')
    return request.me
  }

  const idOf = (request: FastifyRequest) => String((request.params as { id?: unknown }).id)

  const providerOf = (request: FastifyRequest) => {
    const provider = providerById(providers, idOf(request))
    if (!provider) throw new AppError(404, 'unknown_provider')
    return provider
  }

  /** The body for the provider's secret fields: one trimmed string each, nothing else. */
  const secretsOf = (provider: CloudProvider, body: unknown) => {
    const schema = z.strictObject(
      Object.fromEntries(
        provider.secrets.map((field) => [field.id, providerSecretsSchema.shape.apiKey]),
      ),
    )
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    return parsed.data as Record<string, string>
  }

  const full = async (request: FastifyRequest) =>
    transcriptionStatusSchema.parse(await transcription.status(request.me?.timeZone))

  app.get(path, async (request) => {
    admin(request)
    return full(request)
  })

  app.put(path, async (request) => {
    admin(request)
    const parsed = setTranscriptionSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    await transcription.setEnabled(parsed.data.enabled)
    return full(request)
  })

  app.post(`${path}/models/:id/download`, async (request) => {
    admin(request)
    await transcription.download(idOf(request))
    return full(request)
  })

  app.post(`${path}/models/:id/use`, async (request) => {
    admin(request)
    await transcription.use(idOf(request))
    return full(request)
  })

  app.delete(`${path}/models/:id`, async (request) => {
    admin(request)
    await transcription.remove(idOf(request))
    return full(request)
  })

  app.put(`${path}/providers/:id/secrets`, async (request) => {
    admin(request)
    const provider = providerOf(request)
    await transcription.saveSecrets(provider.id, secretsOf(provider, request.body))
    return full(request)
  })

  app.delete(`${path}/providers/:id/secrets`, async (request) => {
    admin(request)
    await transcription.removeSecrets(providerOf(request).id)
    return full(request)
  })

  app.post(`${path}/providers/:id/test`, async (request) => {
    admin(request)
    const provider = providerOf(request)
    const parsed = testBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    const typed = parsed.data.apiKey === undefined ? undefined : { apiKey: parsed.data.apiKey }
    return keyTestResultSchema.parse(await transcription.testKey(provider.id, typed))
  })

  app.post(`${path}/providers/:id/use`, async (request) => {
    admin(request)
    await transcription.useProvider(providerOf(request).id)
    return full(request)
  })

  app.get('/api/v1/transcription', async (request) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    return transcriptionAvailabilitySchema.parse(await transcription.availability())
  })

  app.post(`${path}/backlog`, async (request) => {
    admin(request)
    const queued = await transcription.transcribeBacklog(request.id)
    return { queued }
  })
}
