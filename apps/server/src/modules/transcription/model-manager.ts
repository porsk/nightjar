import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebStream } from 'node:stream/web'
import type { Logger } from '../../logger.ts'
import { modelKey, type Storage } from '../../storage.ts'
import { downloadBytes, isModelReady, type ModelInfo } from './models.ts'

export type DownloadError = 'download_failed' | 'disk_full'

export interface DownloadStatus {
  /** The model that is downloading or failed. `undefined` when nothing is going on. */
  modelId: string | undefined
  state: 'idle' | 'downloading' | 'failed'
  downloadedBytes: number
  totalBytes: number
  error: DownloadError | null
}

interface Options {
  storage: Storage
  logger: Logger
  /** Called when the state changes and while bytes arrive, at most a few times a second. */
  onChange: (status: DownloadStatus) => void
  /** Called once the files of a model are in place. */
  onReady: (modelId: string) => void
  /** Opens the file a download is written to. Tests replace it to simulate a full disk. */
  createWriter?: (path: string) => Writable
}

class DownloadFailure extends Error {}

const progressIntervalMs = 1000

const isDiskFull = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOSPC'

/** Unpacks into `folder`. Paths are relative to it, which keeps tar happy on every platform. */
function untar(archive: string, folder: string): Promise<void> {
  const relativeArchive = relative(folder, archive).split(sep).join('/')
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', relativeArchive], {
      cwd: folder,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let diskFull = false
    child.stderr.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('No space left on device')) diskFull = true
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else if (diskFull) reject(Object.assign(new Error('the disk is full'), { code: 'ENOSPC' }))
      else reject(new DownloadFailure('the archive could not be unpacked'))
    })
  })
}

async function findFile(folder: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return join(entry.parentPath, entry.name)
  }
  return undefined
}

/** Downloads the model files into the data folder, one download at a time. */
export function createModelManager({
  storage,
  logger,
  onChange,
  onReady,
  createWriter = (path) => createWriteStream(path),
}: Options) {
  let status: DownloadStatus = {
    modelId: undefined,
    state: 'idle',
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
  }
  let abort: AbortController | undefined
  let lastReport = 0

  const update = (next: Partial<DownloadStatus>, force = true) => {
    status = { ...status, ...next }
    const now = Date.now()
    if (!force && now - lastReport < progressIntervalMs) return
    lastReport = now
    onChange(status)
  }

  async function fetchTo(url: string, target: string, expectedHash: string, signal: AbortSignal) {
    const response = await fetch(url, { signal })
    if (!response.ok || !response.body) throw new DownloadFailure('the download was refused')
    const hash = createHash('sha256')
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        update({ downloadedBytes: status.downloadedBytes + chunk.length }, false)
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as WebStream), counter, createWriter(target), {
      signal,
    })
    if (hash.digest('hex') !== expectedHash)
      throw new DownloadFailure('the checksum does not match')
  }

  async function place(
    model: ModelInfo,
    item: ModelInfo['downloads'][number],
    downloaded: string,
    work: string,
  ) {
    const folder = storage.localPath(modelKey(model.id))
    if (!item.archive) {
      await rename(downloaded, join(folder, basename(new URL(item.url).pathname)))
      return
    }
    const unpacked = `${work}.unpacked`
    await rm(unpacked, { recursive: true, force: true })
    await storage.makeFolder(`${modelKey(model.id)}.unpacked`)
    try {
      await untar(downloaded, unpacked)
      for (const file of model.files) {
        const found = await findFile(unpacked, file.name)
        if (found) await rename(found, join(folder, file.name))
      }
    } finally {
      await rm(unpacked, { recursive: true, force: true })
    }
  }

  async function run(model: ModelInfo, signal: AbortSignal) {
    await storage.makeFolder(modelKey(model.id))
    const work = storage.localPath(modelKey(model.id))
    const partials: string[] = []
    try {
      for (const [index, item] of model.downloads.entries()) {
        const partial = `${work}.${String(index)}.part`
        partials.push(partial)
        const before = status.downloadedBytes
        await fetchTo(item.url, partial, item.sha256, signal)
        update({ downloadedBytes: before + item.bytes })
        await place(model, item, partial, work)
      }
      if (!(await isModelReady(storage, model))) throw new DownloadFailure('files are missing')
    } finally {
      for (const partial of partials) await rm(partial, { force: true })
    }
  }

  async function download(model: ModelInfo, signal: AbortSignal) {
    try {
      await run(model, signal)
      update({ state: 'idle', downloadedBytes: status.totalBytes })
      logger.info({ modelId: model.id }, 'model download finished')
      onReady(model.id)
    } catch (error) {
      if (signal.aborted) {
        await storage.removeFolder(modelKey(model.id)).catch(() => undefined)
        return
      }
      const diskFull = isDiskFull(error)
      logger.warn(
        {
          modelId: model.id,
          reason: diskFull
            ? 'disk_full'
            : error instanceof DownloadFailure
              ? error.message
              : 'network',
        },
        'model download failed',
      )
      await storage.removeFolder(modelKey(model.id)).catch(() => undefined)
      update({
        state: 'failed',
        downloadedBytes: 0,
        error: diskFull ? 'disk_full' : 'download_failed',
      })
    }
  }

  let running: Promise<void> = Promise.resolve()

  return {
    status: (): DownloadStatus => status,

    /**
     * Starts downloading a model unless its files are already there or a download is running.
     * Returns once the download has started, not when it is done.
     */
    start: async (model: ModelInfo) => {
      if (status.state === 'downloading') return
      status = {
        modelId: model.id,
        state: 'downloading',
        downloadedBytes: 0,
        totalBytes: downloadBytes(model),
        error: null,
      }
      await running
      if (status.state !== 'downloading' || status.modelId !== model.id) return
      if (await isModelReady(storage, model)) {
        status = { ...status, modelId: undefined, state: 'idle' }
        onReady(model.id)
        return
      }
      abort = new AbortController()
      update({ state: 'downloading', downloadedBytes: 0 })
      logger.info({ modelId: model.id }, 'model download started')
      running = download(model, abort.signal)
    },

    /** Resolves when the running download has ended, successfully or not. */
    whenIdle: () => running,

    /** Stops a running download and removes what it wrote. */
    cancel: () => {
      abort?.abort()
      abort = undefined
      if (status.state === 'downloading') {
        update({ modelId: undefined, state: 'idle', downloadedBytes: 0, totalBytes: 0 })
      }
    },
  }
}

export type ModelManager = ReturnType<typeof createModelManager>
