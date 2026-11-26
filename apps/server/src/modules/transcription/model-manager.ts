import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebStream } from 'node:stream/web'
import type { Logger } from '../../logger.ts'
import { modelKey, type Storage } from '../../storage.ts'
import { downloadBytes, isModelReady, type ModelInfo } from './models.ts'

export interface DownloadStatus {
  state: 'idle' | 'downloading' | 'failed'
  downloadedBytes: number
  totalBytes: number
}

interface Options {
  storage: Storage
  model: ModelInfo
  logger: Logger
  /** Called when the state changes and while bytes arrive, at most a few times a second. */
  onChange: (status: DownloadStatus) => void
  /** Called once the model files are in place. */
  onReady: () => void
}

class DownloadError extends Error {}

const progressIntervalMs = 250

/** Unpacks into `folder`. Paths are relative to it, which keeps tar happy on every platform. */
function untar(archive: string, folder: string): Promise<void> {
  const relativeArchive = relative(folder, archive).split(sep).join('/')
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', relativeArchive], { cwd: folder, stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new DownloadError('the archive could not be unpacked'))
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
export function createModelManager({ storage, model, logger, onChange, onReady }: Options) {
  const totalBytes = downloadBytes(model)
  let status: DownloadStatus = { state: 'idle', downloadedBytes: 0, totalBytes }
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
    if (!response.ok || !response.body) throw new DownloadError('the download was refused')
    const hash = createHash('sha256')
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        update({ downloadedBytes: status.downloadedBytes + chunk.length }, false)
        done(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as WebStream),
      counter,
      createWriteStream(target),
      { signal },
    )
    if (hash.digest('hex') !== expectedHash) throw new DownloadError('the checksum does not match')
  }

  async function place(item: ModelInfo['downloads'][number], downloaded: string, work: string) {
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

  async function run(signal: AbortSignal) {
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
        await place(item, partial, work)
      }
      if (!(await isModelReady(storage, model))) throw new DownloadError('files are missing')
    } finally {
      for (const partial of partials) await rm(partial, { force: true })
    }
  }

  async function download(signal: AbortSignal) {
    try {
      await run(signal)
      update({ state: 'idle', downloadedBytes: totalBytes })
      logger.info({ modelId: model.id }, 'model download finished')
      onReady()
    } catch (error) {
      if (signal.aborted) {
        update({ state: 'idle', downloadedBytes: 0 })
        return
      }
      logger.warn(
        { modelId: model.id, reason: error instanceof DownloadError ? error.message : 'network' },
        'model download failed',
      )
      update({ state: 'failed', downloadedBytes: 0 })
    }
  }

  let running: Promise<void> = Promise.resolve()

  return {
    status: (): DownloadStatus => status,

    /**
     * Starts downloading unless the files are already there or a download is running.
     * Returns once the download has started, not when it is done.
     */
    start: async () => {
      if (status.state === 'downloading') return
      if (await isModelReady(storage, model)) {
        update({ state: 'idle', downloadedBytes: totalBytes })
        onReady()
        return
      }
      abort = new AbortController()
      update({ state: 'downloading', downloadedBytes: 0 })
      logger.info({ modelId: model.id }, 'model download started')
      running = download(abort.signal)
    },

    /** Resolves when the running download has ended, successfully or not. */
    whenIdle: () => running,

    /** Stops a running download and removes what it wrote. */
    cancel: () => {
      abort?.abort()
    },
  }
}

export type ModelManager = ReturnType<typeof createModelManager>
