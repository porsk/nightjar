import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ModelList } from '../../src/modules/transcription/models.ts'

/** The default model, first in the list, under its real id. */
export const testModelId = 'whisper-large-v3-turbo-int8'
export const largeModelId = 'whisper-large-v3-int8'

const fileSizes: Record<string, Record<string, number>> = {
  [testModelId]: {
    'test-encoder.onnx': 3_000_000,
    'test-decoder.onnx': 2_000_000,
    'test-tokens.txt': 10_000,
    'silero_vad.onnx': 50_000,
  },
  [largeModelId]: {
    'large-encoder.onnx': 3_500_000,
    'large-decoder.onnx': 2_500_000,
    'large-tokens.txt': 12_000,
    'silero_vad.onnx': 50_000,
  },
}

/** Random model files per model, made once so every test uses the same bytes. */
export const modelFilesOf: Record<string, Record<string, Buffer>> = Object.fromEntries(
  Object.entries(fileSizes).map(([id, sizes]) => [
    id,
    Object.fromEntries(Object.entries(sizes).map(([name, size]) => [name, randomBytes(size)])),
  ]),
)

/** The files of the default model. */
export const modelFiles = modelFilesOf[testModelId] ?? {}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

/** A small HTTP server that stands in for the download site. Counts requests and can misbehave. */
export async function startModelServer() {
  const requests: string[] = []
  const behaviour = { slowMs: 0, dropOnce: false, corrupt: false }
  const chunk = 64 * 1024

  const server = createServer((request, response) => {
    const name = (request.url ?? '').slice(1)
    const [modelId = '', file = ''] = name.split('/')
    const data = modelFilesOf[modelId]?.[file]
    requests.push(name)
    if (!data) {
      response.writeHead(404).end()
      return
    }
    const body = behaviour.corrupt ? Buffer.concat([Buffer.from('x'), data.subarray(1)]) : data
    response.writeHead(200, { 'content-length': body.length })
    let sent = 0
    const dropAt = behaviour.dropOnce && body.length > 1_000_000 ? body.length / 2 : Infinity
    const next = () => {
      if (sent >= dropAt) {
        behaviour.dropOnce = false
        request.socket.destroy()
        return
      }
      if (sent >= body.length) {
        response.end()
        return
      }
      response.write(body.subarray(sent, sent + chunk))
      sent += chunk
      setTimeout(next, behaviour.slowMs)
    }
    next()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`

  const list: ModelList = {
    default: testModelId,
    models: Object.entries(modelFilesOf).map(([id, files]) => ({
      id,
      label: id,
      downloads: Object.entries(files).map(([name, data]) => ({
        url: `${baseUrl}/${id}/${name}`,
        sha256: sha256(data),
        bytes: data.length,
        archive: false,
      })),
      files: Object.entries(files).map(([name, data]) => ({ name, bytes: data.length })),
    })),
  }

  return {
    list,
    requests,
    behaviour,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
}

export type ModelServer = Awaited<ReturnType<typeof startModelServer>>
