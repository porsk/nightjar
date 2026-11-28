import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  setTranscriptionSchema,
  transcriptionAvailabilitySchema,
  transcriptionStatusSchema,
} from '@nightjar/shared/recordings'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '../../errors.ts'
import type { Logger } from '../../logger.ts'
import type { TranscriptionService } from './service.ts'

type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>

const path = '/api/v1/admin/transcription'

export function registerTranscriptionRoutes(
  app: App,
  { transcription }: { transcription: TranscriptionService },
) {
  const admin = (request: FastifyRequest) => {
    if (!request.me) throw new AppError(401, 'unauthorized')
    if (!request.me.isAdmin) throw new AppError(403, 'forbidden')
  }

  const modelId = (request: FastifyRequest) => String((request.params as { id?: unknown }).id)

  app.get(path, async (request) => {
    admin(request)
    return transcriptionStatusSchema.parse(await transcription.status())
  })

  app.put(path, async (request) => {
    admin(request)
    const parsed = setTranscriptionSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request')
    return transcriptionStatusSchema.parse(await transcription.setEnabled(parsed.data.enabled))
  })

  app.post(`${path}/models/:id/download`, async (request) => {
    admin(request)
    return transcriptionStatusSchema.parse(await transcription.download(modelId(request)))
  })

  app.post(`${path}/models/:id/use`, async (request) => {
    admin(request)
    return transcriptionStatusSchema.parse(await transcription.use(modelId(request)))
  })

  app.delete(`${path}/models/:id`, async (request) => {
    admin(request)
    return transcriptionStatusSchema.parse(await transcription.remove(modelId(request)))
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
