import { readdir, rm } from 'node:fs/promises'
import type {
  ModelStatus,
  RecordingStatus,
  TranscriptionAvailability,
  TranscriptionStatus,
} from '@nightjar/shared/recordings'
import { asc, count, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { instanceSettings, recordings } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import type { Events } from '../../events.ts'
import type { Jobs } from '../../jobs.ts'
import type { Logger } from '../../logger.ts'
import { modelKey, type Storage } from '../../storage.ts'
import { createModelManager, type DownloadStatus } from './model-manager.ts'
import {
  diskBytes,
  downloadBytes,
  isModelReady,
  modelById,
  type ModelInfo,
  type ModelList,
} from './models.ts'

interface Dependencies {
  database: Database
  storage: Storage
  jobs: Pick<Jobs, 'enqueueTranscription'>
  events: Events
  logger: Logger
  models: ModelList
}

interface SavedRecording {
  id: string
  userId: string
  entryId: string
  durationMs: number
}

type Settings = NonNullable<Awaited<ReturnType<ReturnType<typeof createSettingsReader>>>>

const createSettingsReader = (database: Database) => async () => {
  const [settings] = await database.db
    .select({
      enabled: instanceSettings.transcriptionEnabled,
      activeModel: instanceSettings.activeModel,
      downloadState: instanceSettings.modelDownloadState,
      downloadedBytes: instanceSettings.modelDownloadedBytes,
      downloadId: instanceSettings.modelDownloadId,
      downloadUse: instanceSettings.modelDownloadUse,
      downloadError: instanceSettings.modelDownloadError,
    })
    .from(instanceSettings)
  return settings
}

const noDownload = {
  modelDownloadState: 'idle',
  modelDownloadedBytes: 0,
  modelDownloadId: null,
  modelDownloadUse: false,
  modelDownloadError: null,
} as const

/** Decides what happens to recordings: transcribed, waiting for the model, or left as audio only. */
export function createTranscriptionService({
  database,
  storage,
  jobs,
  events,
  logger,
  models,
}: Dependencies) {
  const { db } = database
  const readSettings = createSettingsReader(database)

  const saveSettings = (values: Partial<typeof instanceSettings.$inferInsert>) =>
    db.update(instanceSettings).set(values).where(eq(instanceSettings.id, 1))

  const activeModelOf = (settings: Pick<Settings, 'activeModel'> | undefined): ModelInfo =>
    modelById(models, settings?.activeModel ?? models.default)

  const countByStatus = async (status: RecordingStatus) => {
    const [row] = await db
      .select({ total: count() })
      .from(recordings)
      .where(eq(recordings.status, status))
    return row?.total ?? 0
  }

  async function modelStatuses(settings: Settings | undefined): Promise<ModelStatus[]> {
    const statuses: ModelStatus[] = []
    for (const model of models.models) {
      const base = {
        id: model.id,
        downloadBytes: downloadBytes(model),
        diskBytes: diskBytes(model),
        downloadedBytes: 0,
        useWhenReady: false,
        error: null,
      }
      const mine = settings?.downloadId === model.id ? settings : undefined
      if (await isModelReady(storage, model)) {
        statuses.push({ ...base, state: 'downloaded' })
      } else if (mine?.downloadState === 'downloading') {
        statuses.push({
          ...base,
          state: 'downloading',
          downloadedBytes: mine.downloadedBytes,
          useWhenReady: mine.downloadUse,
        })
      } else if (mine?.downloadState === 'failed') {
        statuses.push({
          ...base,
          state: 'failed',
          useWhenReady: mine.downloadUse,
          error: mine.downloadError ?? 'download_failed',
        })
      } else {
        statuses.push({ ...base, state: 'not_downloaded' })
      }
    }
    return statuses
  }

  async function status(): Promise<TranscriptionStatus> {
    const settings = await readSettings()
    const enabled = settings?.enabled ?? false
    const active = activeModelOf(settings)
    const list = await modelStatuses(settings)
    const row = list.find((candidate) => candidate.id === active.id)
    const base = {
      enabled,
      totalBytes: downloadBytes(active),
      backlogCount: await countByStatus('skipped'),
      activeModel: active.id,
      models: list,
    }
    if (!enabled) return { ...base, state: 'off', downloadedBytes: 0 }
    if (row?.state === 'downloaded') {
      return { ...base, state: 'ready', downloadedBytes: base.totalBytes }
    }
    return {
      ...base,
      state: row?.state === 'failed' ? 'failed' : 'downloading',
      downloadedBytes: row?.downloadedBytes ?? 0,
    }
  }

  const availability = async (): Promise<TranscriptionAvailability> => {
    const settings = await readSettings()
    if (!settings?.enabled) return { state: 'off' }
    return { state: (await isModelReady(storage, activeModelOf(settings))) ? 'ready' : 'not_ready' }
  }

  const queue = (recording: SavedRecording, requestId?: string, replaceEdited?: boolean) =>
    jobs.enqueueTranscription(
      {
        userId: recording.userId,
        recordingId: recording.id,
        requestId,
        ...(replaceEdited ? { replaceEdited } : {}),
      },
      recording.durationMs,
    )

  /** Queues every recording that waits for the model or was left half done by a stopped server. */
  async function queueWaiting() {
    const waiting = await db
      .select({
        id: recordings.id,
        userId: recordings.userId,
        entryId: recordings.entryId,
        durationMs: recordings.durationMs,
        replaceEdited: recordings.replaceEdited,
      })
      .from(recordings)
      .where(inArray(recordings.status, ['pending', 'transcribing']))
      .orderBy(asc(recordings.createdAt), asc(recordings.id))
    for (const recording of waiting) await queue(recording, undefined, recording.replaceEdited)
  }

  /** Model events go out one after the other, so the last one is always the newest. */
  let publishing = Promise.resolve()

  const publishModels = async () => {
    const { state, downloadedBytes, totalBytes, activeModel, models: list } = await status()
    await events.publishToAdmins({
      type: 'model.updated',
      state,
      downloadedBytes,
      totalBytes,
      activeModel,
      models: list,
    })
  }

  const inOrder = (work: () => Promise<void>) => {
    publishing = publishing.then(work).catch(() => {
      logger.warn('could not publish the model state')
    })
    return publishing
  }

  const manager = createModelManager({
    storage,
    logger,
    onChange: (download: DownloadStatus) => {
      void inOrder(async () => {
        await saveSettings({
          modelDownloadState: download.state,
          modelDownloadedBytes: download.downloadedBytes,
          modelDownloadError: download.error,
          ...(download.modelId === undefined
            ? { modelDownloadId: null, modelDownloadUse: false }
            : {}),
        })
        await publishModels()
      })
    },
    onReady: (modelId) => {
      void inOrder(async () => {
        const settings = await readSettings()
        const mine = settings?.downloadId === modelId
        const useIt = mine && settings.downloadUse
        await saveSettings({
          ...(mine || settings?.downloadId === null ? noDownload : {}),
          ...(useIt ? { activeModel: modelId } : {}),
        })
        if (useIt) logger.info({ modelId }, 'model switched')
        await publishModels()
        await queueWaiting()
      })
    },
  })

  const findModel = (id: string) => {
    const model = models.models.find((candidate) => candidate.id === id)
    if (!model) throw new AppError(404, 'unknown_model')
    return model
  }

  const downloadingId = () =>
    manager.status().state === 'downloading' ? manager.status().modelId : undefined

  /** Download requests are handled one after the other, so two at once cannot both start. */
  let starting: Promise<unknown> = Promise.resolve()
  const startDownload = (model: ModelInfo, useWhenReady: boolean) => {
    const result = starting.then(() => startDownloadNow(model, useWhenReady))
    starting = result.catch(() => undefined)
    return result
  }

  /** Starts the download of a model, or throws when another model is already downloading. */
  async function startDownloadNow(model: ModelInfo, useWhenReady: boolean) {
    const running = downloadingId()
    if (running !== undefined && running !== model.id) throw new AppError(409, 'download_running')
    if (running === model.id) {
      if (useWhenReady) await saveSettings({ modelDownloadUse: true })
      return
    }
    if (await isModelReady(storage, model)) return
    await saveSettings({
      modelDownloadId: model.id,
      modelDownloadUse: useWhenReady,
      modelDownloadError: null,
      modelDownloadState: 'downloading',
      modelDownloadedBytes: 0,
    })
    await manager.start(model)
  }

  /** Removes what a stopped server left behind in the models folder. */
  async function removeLeftovers() {
    const names = await readdir(storage.localPath('models')).catch(() => [])
    for (const name of names) {
      if (name.endsWith('.part') || name.endsWith('.unpacked')) {
        await rm(storage.localPath(modelKey(name)), { recursive: true, force: true })
      }
    }
  }

  /** The active model is used and downloaded when transcription is on. */
  async function ensureActiveModel(active: ModelInfo) {
    if (await isModelReady(storage, active)) await manager.start(active)
    else await startDownload(active, false)
  }

  return {
    status,

    availability,

    /** Turns transcription on or off. Turning it on downloads the active model if it is not there yet. */
    setEnabled: async (enabled: boolean) => {
      await saveSettings({ transcriptionEnabled: enabled })
      if (enabled) {
        await ensureActiveModel(activeModelOf(await readSettings()))
      } else {
        manager.cancel()
        await publishing
        const stopped = await db
          .update(recordings)
          .set({ status: 'skipped' })
          .where(eq(recordings.status, 'pending'))
          .returning({ id: recordings.id, userId: recordings.userId, entryId: recordings.entryId })
        for (const recording of stopped) {
          await events.publishToUser(recording.userId, {
            type: 'recording.updated',
            entryId: recording.entryId,
            recordingId: recording.id,
            status: 'skipped',
          })
        }
      }
      return status()
    },

    /** Starts downloading a model without using it. */
    download: async (id: string) => {
      await startDownload(findModel(id), false)
      return status()
    },

    /** Makes a model active at once, or downloads it first and then makes it active. */
    use: async (id: string) => {
      const model = findModel(id)
      if (await isModelReady(storage, model)) {
        await saveSettings({ activeModel: model.id })
        logger.info({ modelId: model.id }, 'model switched')
        await inOrder(publishModels)
      } else {
        await startDownload(model, true)
      }
      return status()
    },

    /** Removes the files of a model that is not in use and not downloading. */
    remove: async (id: string) => {
      const model = findModel(id)
      const settings = await readSettings()
      if (activeModelOf(settings).id === model.id) throw new AppError(409, 'model_in_use')
      if (downloadingId() === model.id) throw new AppError(409, 'model_downloading')
      await storage.removeFolder(modelKey(model.id))
      if (settings?.downloadId === model.id) await saveSettings(noDownload)
      logger.info({ modelId: model.id }, 'model deleted')
      await inOrder(publishModels)
      return status()
    },

    /** The state of a recording that was just saved. */
    initialStatus: async (): Promise<'pending' | 'skipped'> =>
      (await readSettings())?.enabled ? 'pending' : 'skipped',

    /** Queues a saved recording when the model is ready. Otherwise it waits and is queued once the model arrives. */
    schedule: async (recording: SavedRecording, requestId?: string, replaceEdited?: boolean) => {
      if ((await availability()).state === 'ready') await queue(recording, requestId, replaceEdited)
    },

    /** Moves recordings that were never transcribed into the queue. Returns how many. */
    transcribeBacklog: async (requestId?: string) => {
      if ((await availability()).state !== 'ready') throw new AppError(409, 'model_not_ready')
      const moved = await db
        .update(recordings)
        .set({ status: 'pending' })
        .where(eq(recordings.status, 'skipped'))
        .returning({
          id: recordings.id,
          userId: recordings.userId,
          entryId: recordings.entryId,
          durationMs: recordings.durationMs,
          createdAt: recordings.createdAt,
        })
      moved.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      for (const recording of moved) {
        await events.publishToUser(recording.userId, {
          type: 'recording.updated',
          entryId: recording.entryId,
          recordingId: recording.id,
          status: 'pending',
        })
        await queue(recording, requestId)
      }
      return moved.length
    },

    /**
     * On server start: remove leftovers of a stopped download, fetch the active model if it is missing,
     * or pick up recordings that never got a job. A stopped download of another model is not resumed.
     */
    resume: async () => {
      await removeLeftovers()
      const settings = await readSettings()
      const active = activeModelOf(settings)
      if (
        settings?.downloadState === 'downloading' &&
        settings.downloadId !== null &&
        settings.downloadId !== active.id
      ) {
        await saveSettings({
          modelDownloadState: 'failed',
          modelDownloadedBytes: 0,
          modelDownloadError: 'download_failed',
        })
        logger.warn(
          { modelId: settings.downloadId, reason: 'server_stopped' },
          'model download failed',
        )
        await inOrder(publishModels)
      }
      if (settings?.enabled) await ensureActiveModel(active)
    },

    whenIdle: () => manager.whenIdle(),
  }
}

export type TranscriptionService = ReturnType<typeof createTranscriptionService>
