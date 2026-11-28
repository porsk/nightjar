import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createGladiaProvider } from '../../src/modules/transcription/cloud/gladia.ts'
import type { CloudProvider } from '../../src/modules/transcription/cloud/provider.ts'
import { createSonioxProvider } from '../../src/modules/transcription/cloud/soniox.ts'

type Step = 'upload' | 'start' | 'poll' | 'delete' | 'check'
type Vendor = 'soniox' | 'gladia'

export interface RecordedRequest {
  vendor: Vendor
  method: string
  /** Path below the vendor base, like `/files` or `/pre-recorded/abc`. */
  path: string
  /** Which auth header came with the request, and whether it carried the key the server accepts. */
  auth: 'bearer' | 'x-gladia-key' | 'none'
  keyAccepted: boolean
  bytes: number
  head: Buffer
  fileName: string | undefined
  json: Record<string, unknown> | undefined
}

interface StoredFile {
  data: Buffer
  name: string
  deleted: boolean
}

interface StoredJob {
  fileId: string
  body: Record<string, unknown>
  polls: number
  text: string
  language: string
  deleted: boolean
}

export interface CloudBehaviour {
  /** The key the server accepts. Any other key gets 401. Unset accepts every key. */
  validKey: string | undefined
  /** Makes every request answer 401. */
  rejectKey: boolean
  /** A fixed answer status for the calls of one step. */
  status: Partial<Record<Step, number>>
  /** Closes the connection without an answer. */
  refuse: boolean
  /** How many polls answer "running" before the job is done. `Infinity` never finishes. */
  pollsUntilDone: number
  /** The next N delete calls answer 500. */
  failDeletes: number
  /** The vendor job ends in its error state. */
  jobError: boolean
  /** The text of each job, in the order they start. The last one repeats. */
  texts: string[]
  /** The language the vendor reports when the request asks for several. */
  detected: string
  /** Soniox tokens, replacing the one token made from the text. */
  tokens: { text: string; language: string }[] | undefined
  /** Waits this long before answering every call. */
  delayMs: number
}

const defaults = (): CloudBehaviour => ({
  validKey: undefined,
  rejectKey: false,
  status: {},
  refuse: false,
  pollsUntilDone: 0,
  failDeletes: 0,
  jobError: false,
  texts: [],
  detected: 'hu',
  tokens: undefined,
  delayMs: 0,
})

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * A local HTTP server that speaks the Soniox paths under `/soniox/v1` and the Gladia paths under
 * `/gladia/v2`. Keeps uploads in memory and records every request, so tests can check what was sent.
 */
export async function startCloudServer() {
  const behaviour = defaults()
  const requests: RecordedRequest[] = []
  const files = new Map<string, StoredFile>()
  const jobs = new Map<string, StoredJob>()
  let counter = 0
  let started = 0
  let origin = ''

  const nextId = (kind: string) => `${kind}-${String(++counter)}`

  const textFor = (index: number) =>
    behaviour.texts[Math.min(index, behaviour.texts.length - 1)] ??
    `Fixture transcript ${String(index + 1)}`

  const send = (response: ServerResponse, status: number, body?: unknown) => {
    if (body === undefined) {
      response.writeHead(status).end()
      return
    }
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }

  const answerFor = (step: Step) => behaviour.status[step]

  /** Lets a test in another process set the behaviour and read the requests (the e2e tests do). */
  async function control(path: string, request: IncomingMessage, response: ServerResponse) {
    if (path === '/control/behaviour') {
      Object.assign(behaviour, JSON.parse((await readBody(request)).toString('utf8') || '{}'))
      send(response, 200, {})
      return
    }
    if (path === '/control/reset') {
      reset()
      send(response, 200, {})
      return
    }
    if (path === '/control/requests') {
      send(
        response,
        200,
        requests.map(({ vendor, method, path: requested, auth, fileName }) => ({
          vendor,
          method,
          path: requested,
          auth,
          fileName,
        })),
      )
      return
    }
    send(response, 404)
  }

  function reset() {
    Object.assign(behaviour, defaults())
    requests.length = 0
    files.clear()
    jobs.clear()
    started = 0
    counter = 0
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', origin)
    const vendor: Vendor | undefined = url.pathname.startsWith('/soniox/v1')
      ? 'soniox'
      : url.pathname.startsWith('/gladia/v2')
        ? 'gladia'
        : undefined
    if (url.pathname.startsWith('/control/')) return control(url.pathname, request, response)
    if (!vendor) {
      send(response, 404)
      return
    }
    const path = url.pathname.slice(vendor === 'soniox' ? '/soniox/v1'.length : '/gladia/v2'.length)
    const raw = await readBody(request)
    const bearer = request.headers.authorization?.replace(/^Bearer /, '')
    const gladiaKey = request.headers['x-gladia-key']
    const key = vendor === 'soniox' ? bearer : typeof gladiaKey === 'string' ? gladiaKey : undefined
    const record: RecordedRequest = {
      vendor,
      method: request.method ?? 'GET',
      path,
      auth: bearer ? 'bearer' : gladiaKey ? 'x-gladia-key' : 'none',
      keyAccepted:
        key !== undefined &&
        key !== '' &&
        !behaviour.rejectKey &&
        (behaviour.validKey === undefined || key === behaviour.validKey),
      bytes: raw.length,
      head: raw.subarray(0, 16),
      fileName: undefined,
      json: undefined,
    }
    requests.push(record)
    if (behaviour.refuse) {
      request.socket.destroy()
      return undefined
    }
    if (behaviour.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs))
    if (!record.keyAccepted) {
      send(response, 401, { error: 'bad key' })
      return
    }

    const contentType = request.headers['content-type'] ?? ''
    let form: FormData | undefined
    if (contentType.startsWith('multipart/form-data')) {
      form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
    } else if (contentType.startsWith('application/json')) {
      record.json = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    }
    const method = record.method
    const segments = path.split('/').filter(Boolean)
    const [first, id, third] = segments

    const step = ((): Step | undefined => {
      if (method === 'DELETE') return 'delete'
      if (method === 'GET' && segments.length === 1) return 'check'
      if (method === 'POST' && (first === 'files' || first === 'upload')) return 'upload'
      if (method === 'POST') return 'start'
      if (method === 'GET') return 'poll'
      return undefined
    })()
    const forced = step ? answerFor(step) : undefined
    if (forced !== undefined) {
      send(response, forced, {})
      return
    }
    if (step === 'delete' && behaviour.failDeletes > 0) {
      behaviour.failDeletes--
      send(response, 500, {})
      return
    }

    const upload = (field: string) => {
      const part = form?.get(field)
      if (!(part instanceof File)) return undefined
      return part
    }

    if (vendor === 'soniox') {
      if (method === 'GET' && first === 'files') {
        send(response, 200, { files: [] })
        return
      }
      if (method === 'POST' && first === 'files') {
        const part = upload('file')
        if (!part) {
          send(response, 400, {})
          return
        }
        const fileId = nextId('sf')
        record.fileName = part.name
        files.set(fileId, {
          data: Buffer.from(await part.arrayBuffer()),
          name: part.name,
          deleted: false,
        })
        send(response, 201, { id: fileId })
        return
      }
      if (method === 'POST' && first === 'transcriptions') {
        const body = record.json ?? {}
        const hints = Array.isArray(body.language_hints) ? (body.language_hints as string[]) : []
        const jobId = nextId('st')
        jobs.set(jobId, {
          fileId: String(body.file_id),
          body,
          polls: 0,
          text: textFor(started++),
          language: hints.length === 1 ? (hints[0] ?? 'hu') : behaviour.detected,
          deleted: false,
        })
        send(response, 201, { id: jobId })
        return
      }
      if (method === 'GET' && first === 'transcriptions' && id) {
        const job = jobs.get(id)
        if (!job || job.deleted) {
          send(response, 404, {})
          return
        }
        if (third === 'transcript') {
          send(response, 200, {
            id,
            text: job.text,
            tokens: behaviour.tokens ?? [{ text: job.text, language: job.language }],
          })
          return
        }
        job.polls++
        if (behaviour.jobError) {
          send(response, 200, { id, status: 'error', error_message: 'x' })
          return
        }
        const done = job.polls > behaviour.pollsUntilDone
        send(response, 200, { id, status: done ? 'completed' : 'processing' })
        return
      }
      if (method === 'DELETE' && (first === 'transcriptions' || first === 'files') && id) {
        const item = first === 'files' ? files.get(id) : jobs.get(id)
        if (!item || item.deleted) {
          send(response, 404, {})
          return
        }
        item.deleted = true
        send(response, 204)
        return
      }
      send(response, 404, {})
      return
    }

    if (method === 'GET' && first === 'pre-recorded' && !id) {
      send(response, 200, { items: [] })
      return
    }
    if (method === 'POST' && first === 'upload') {
      const part = upload('audio')
      if (!part) {
        send(response, 400, {})
        return
      }
      const fileId = nextId('gf')
      record.fileName = part.name
      files.set(fileId, {
        data: Buffer.from(await part.arrayBuffer()),
        name: part.name,
        deleted: false,
      })
      send(response, 201, { audio_url: `${origin}/gladia/files/${fileId}` })
      return
    }
    if (method === 'POST' && first === 'pre-recorded') {
      const body = record.json ?? {}
      const config = (body.language_config ?? {}) as { languages?: string[] }
      const languages = config.languages ?? []
      const jobId = nextId('gj')
      jobs.set(jobId, {
        fileId: String(body.audio_url).split('/').pop() ?? '',
        body,
        polls: 0,
        text: textFor(started++),
        language: languages.length === 1 ? (languages[0] ?? 'hu') : behaviour.detected,
        deleted: false,
      })
      send(response, 201, { id: jobId })
      return
    }
    if (method === 'GET' && first === 'pre-recorded' && id) {
      const job = jobs.get(id)
      if (!job || job.deleted) {
        send(response, 404, {})
        return
      }
      job.polls++
      if (behaviour.jobError) {
        send(response, 200, { id, status: 'error', error_code: 500 })
        return
      }
      const done = job.polls > behaviour.pollsUntilDone
      send(response, 200, {
        id,
        status: done ? 'done' : 'processing',
        ...(done
          ? {
              result: {
                transcription: { full_transcript: job.text, languages: [job.language] },
              },
            }
          : {}),
      })
      return
    }
    if (method === 'DELETE' && first === 'pre-recorded' && id) {
      const job = jobs.get(id)
      if (!job || job.deleted) {
        send(response, 404, {})
        return
      }
      job.deleted = true
      const file = files.get(job.fileId)
      if (file) file.deleted = true
      send(response, 202)
      return
    }
    send(response, 404, {})
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`

  const providers = (): CloudProvider[] => [
    createSonioxProvider({ baseUrl: `${origin}/soniox/v1` }),
    createGladiaProvider({ baseUrl: `${origin}/gladia/v2` }),
  ]

  return {
    origin,
    behaviour,
    requests,
    files,
    jobs,
    providers,
    /** Calls of one kind, like `callsTo('soniox', 'POST', '/files')`. */
    callsTo: (vendor: Vendor, method: string, path: string) =>
      requests.filter(
        (request) =>
          request.vendor === vendor &&
          request.method === method &&
          (request.path === path || request.path.startsWith(`${path}/`)),
      ),
    /** Files and jobs that were uploaded or created and not deleted. */
    undeleted: () =>
      [...files.values()].filter((file) => !file.deleted).length +
      [...jobs.values()].filter((job) => !job.deleted).length,
    reset,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
}

export type CloudServer = Awaited<ReturnType<typeof startCloudServer>>
