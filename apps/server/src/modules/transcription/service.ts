import { readdir, rm } from 'node:fs/promises'
import type {
  EngineUsage,
  KeyTestResult,
  ModelStatus,
  ProviderStatus,
  RecordingStatus,
  TranscriptionAvailability,
  TranscriptionStatus,
} from '@nightjar/shared/recordings'
import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Database } from '../../database.ts'
import { instanceSettings, recordings, transcripts } from '../../db/schema.ts'
import { AppError } from '../../errors.ts'
import type { Events } from '../../events.ts'
import type { Jobs } from '../../jobs.ts'
import type { Logger } from '../../logger.ts'
import { modelKey, type Storage } from '../../storage.ts'
import type { CloudProvider } from './cloud/provider.ts'
import { providerById } from './cloud/registry.ts'
import type { KeyStore } from './cloud/key-store.ts'
import { estimatedCost, monthStart } from './cloud/usage.ts'
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
  providers: readonly CloudProvider[]
  keys: KeyStore
  fetch?: typeof fetch
  now?: () => Date
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
      activeEngine: instanceSettings.activeEngine,
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

/** The longest a key check may take before it counts as unreachable. */
const keyTestLimitMs = 10_000

/** Decides what happens to recordings: transcribed, waiting for the engine, or left as audio only. */
export function createTranscriptionService({
  database,
  storage,
  jobs,
  events,
  logger,
  models,
  providers,
  keys,
  fetch: fetchFn = fetch,
  now = () => new Date(),
}: Dependencies) {
  const { db } = database
  const readSettings = createSettingsReader(database)

  const saveSettings = (values: Partial<typeof instanceSettings.$inferInsert>) =>
    db.update(instanceSettings).set(values).where(eq(instanceSettings.id, 1))

  const activeModelOf = (settings: Pick<Settings, 'activeEngine'> | undefined): ModelInfo =>
    modelById(models, settings?.activeEngine ?? models.default)

  /** The engine in use: a provider, or a local model (the default one when the saved id is unknown). */
  const activeEngineOf = (settings: Pick<Settings, 'activeEngine'> | undefined) => {
    const provider = providerById(providers, settings?.activeEngine ?? '')
    return provider
      ? ({ kind: 'cloud', provider } as const)
      : ({ kind: 'local', model: activeModelOf(settings) } as const)
  }

  const findProvider = (id: string) => {
    const provider = providerById(providers, id)
    if (!provider) throw new AppError(404, 'unknown_provider')
    return provider
  }

  const hasReadableKey = async (provider: CloudProvider) =>
    (await keys.read(provider.id)).state === 'ready'

  const countByStatus = async (status: RecordingStatus) => {
    const [row] = await db
      .select({ total: count() })
      .from(recordings)
      .where(eq(recordings.status, status))
    return row?.total ?? 0
  }

  async function providerStatuses(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = []
    for (const provider of providers) {
      const saved = await keys.read(provider.id)
      statuses.push({
        id: provider.id,
        label: provider.label,
        configured: saved.state === 'ready',
        keyError: saved.state === 'unreadable' ? 'unreadable' : null,
        pricePerHour: provider.pricePerHour,
      })
    }
    return statuses
  }

  /** Audio made into text by each provider since the month began in the asker's time zone. */
  async function usageOf(timeZone: string): Promise<EngineUsage[]> {
    const since = monthStart(now(), timeZone)
    const rows = await db
      .select({
        engine: transcripts.model,
        audioMs: sql<number>`coalesce(sum(${recordings.durationMs}), 0)::bigint`.mapWith(Number),
      })
      .from(transcripts)
      .innerJoin(recordings, eq(recordings.id, transcripts.recordingId))
      .where(
        and(
          inArray(
            transcripts.model,
            providers.map((provider) => provider.id),
          ),
          gte(transcripts.transcribedAt, since),
        ),
      )
      .groupBy(transcripts.model)
    return providers.map((provider) => {
      const audioMs = rows.find((row) => row.engine === provider.id)?.audioMs ?? 0
      return {
        engine: provider.id,
        audioMs,
        estimatedCost: estimatedCost(audioMs, provider.pricePerHour.amount),
      }
    })
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

  async function statusWithoutUsage(): Promise<Omit<TranscriptionStatus, 'usage'>> {
    const settings = await readSettings()
    const enabled = settings?.enabled ?? false
    const engine = activeEngineOf(settings)
    const list = await modelStatuses(settings)
    const base = {
      enabled,
      backlogCount: await countByStatus('skipped'),
      models: list,
      providers: await providerStatuses(),
    }
    if (engine.kind === 'cloud') {
      const state = !enabled
        ? 'off'
        : (await hasReadableKey(engine.provider))
          ? 'ready'
          : 'needs_key'
      return {
        ...base,
        state,
        totalBytes: 0,
        downloadedBytes: 0,
        activeEngine: engine.provider.id,
      }
    }
    const active = engine.model
    const row = list.find((candidate) => candidate.id === active.id)
    const local = { ...base, totalBytes: downloadBytes(active), activeEngine: active.id }
    if (!enabled) return { ...local, state: 'off', downloadedBytes: 0 }
    if (row?.state === 'downloaded') {
      return { ...local, state: 'ready', downloadedBytes: local.totalBytes }
    }
    return {
      ...local,
      state: row?.state === 'failed' ? 'failed' : 'downloading',
      downloadedBytes: row?.downloadedBytes ?? 0,
    }
  }

  /** `timeZone` is the asker's, for the month of the usage estimate. */
  async function status(timeZone = 'UTC'): Promise<TranscriptionStatus> {
    return { ...(await statusWithoutUsage()), usage: await usageOf(timeZone) }
  }

  const availability = async (): Promise<TranscriptionAvailability> => {
    const settings = await readSettings()
    const engine = activeEngineOf(settings)
    const described = {
      id: engine.kind === 'cloud' ? engine.provider.id : engine.model.id,
      kind: engine.kind,
    }
    if (!settings?.enabled) return { state: 'off', engine: described }
    const usable =
      engine.kind === 'cloud'
        ? await hasReadableKey(engine.provider)
        : await isModelReady(storage, engine.model)
    return { state: usable ? 'ready' : 'not_ready', engine: described }
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

  /** Queues every recording that waits for the engine or was left half done by a stopped server. */
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
    const {
      state,
      downloadedBytes,
      totalBytes,
      activeEngine,
      models: list,
      providers: known,
    } = await statusWithoutUsage()
    await events.publishToAdmins({
      type: 'model.updated',
      state,
      downloadedBytes,
      totalBytes,
      activeEngine,
      models: list,
      providers: known,
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
          ...(useIt ? { activeEngine: modelId } : {}),
        })
        if (useIt) logger.info({ engine: modelId }, 'engine switched')
        await publishModels()
        if ((await availability()).state === 'ready') await queueWaiting()
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

  /** Download, switch and delete requests are handled one after the other, so they cannot undo each other. */
  let starting: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const result = starting.then(work)
    starting = result.catch(() => undefined)
    return result
  }
  const startDownload = (model: ModelInfo, useWhenReady: boolean) =>
    serialized(() => startDownloadNow(model, useWhenReady))

  const requireEnabled = async () => {
    if (!(await readSettings())?.enabled) throw new AppError(409, 'model_not_ready')
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

  /** A local model is downloaded when it is missing. A cloud engine downloads nothing. */
  async function ensureActiveEngine(settings: Settings | undefined) {
    const engine = activeEngineOf(settings)
    if (engine.kind === 'cloud') {
      if (await hasReadableKey(engine.provider)) await queueWaiting()
    } else if (await isModelReady(storage, engine.model)) {
      await manager.start(engine.model)
    } else {
      await startDownload(engine.model, false)
    }
  }

  const providerOfKeyRoute = async (id: string) => {
    const provider = findProvider(id)
    const settings = await readSettings()
    return { provider, settings }
  }

  return {
    status,

    availability,

    /** Turns transcription on or off. Turning it on downloads the active model if it is not there yet. */
    setEnabled: async (enabled: boolean) => {
      await saveSettings({ transcriptionEnabled: enabled })
      if (enabled) {
        await ensureActiveEngine(await readSettings())
      } else {
        manager.cancel()
        await publishing
        const stopped = await db
          .update(recordings)
          .set({ status: 'skipped', replaceEdited: false })
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
    },

    /** Starts downloading a model without using it. */
    download: async (id: string) => {
      const model = findModel(id)
      await requireEnabled()
      await startDownload(model, false)
    },

    /** Makes a model active at once, or downloads it first and then makes it active. */
    use: async (id: string) => {
      const model = findModel(id)
      await requireEnabled()
      await serialized(async () => {
        if (await isModelReady(storage, model)) {
          await saveSettings({ activeEngine: model.id, modelDownloadUse: false })
          logger.info({ engine: model.id }, 'engine switched')
          await inOrder(publishModels)
          await queueWaiting()
        } else {
          await startDownloadNow(model, true)
        }
      })
    },

    /** Removes the files of a model that is not in use and not downloading. */
    remove: async (id: string) => {
      const model = findModel(id)
      await serialized(async () => {
        const settings = await readSettings()
        if (activeEngineOf(settings).kind === 'local' && activeModelOf(settings).id === model.id) {
          throw new AppError(409, 'model_in_use')
        }
        if (downloadingId() === model.id) throw new AppError(409, 'model_downloading')
        await storage.removeFolder(modelKey(model.id))
        if (settings?.downloadId === model.id) await saveSettings(noDownload)
        logger.info({ modelId: model.id }, 'model deleted')
        await inOrder(publishModels)
      })
    },

    /** Saves the key of a provider, replacing any saved one. A new key for the active engine queues waiting recordings. */
    saveSecrets: async (id: string, secrets: Record<string, string>) => {
      const { provider, settings } = await providerOfKeyRoute(id)
      await keys.save(provider.id, secrets)
      logger.info({ provider: provider.id }, 'provider key saved')
      await inOrder(publishModels)
      const engine = activeEngineOf(settings)
      if (settings?.enabled && engine.kind === 'cloud' && engine.provider.id === provider.id) {
        if ((await availability()).state === 'ready') await queueWaiting()
      }
    },

    /** Removes the saved key. The key of the engine in use stays. */
    removeSecrets: async (id: string) => {
      const provider = findProvider(id)
      await serialized(async () => {
        const engine = activeEngineOf(await readSettings())
        if (engine.kind === 'cloud' && engine.provider.id === provider.id) {
          throw new AppError(409, 'engine_in_use')
        }
        await keys.remove(provider.id)
        logger.info({ provider: provider.id }, 'provider key removed')
        await inOrder(publishModels)
      })
    },

    /** Checks a typed key, or the saved one when none is given. Sends no audio and saves nothing. */
    testKey: async (id: string, typed?: Record<string, string>): Promise<KeyTestResult> => {
      const provider = findProvider(id)
      let secrets = typed
      if (!secrets) {
        const saved = await keys.read(provider.id)
        if (saved.state !== 'ready') throw new AppError(409, 'api_key_missing')
        secrets = saved.secrets
      }
      const result = await provider
        .checkKey({ secrets, fetch: fetchFn, signal: AbortSignal.timeout(keyTestLimitMs) })
        .catch(() => 'unreachable' as const)
      logger.info({ provider: provider.id, result }, 'provider key tested')
      return { result }
    },

    /** Makes a provider the engine in use. Needs a readable key. */
    useProvider: async (id: string) => {
      const provider = findProvider(id)
      await requireEnabled()
      await serialized(async () => {
        if (!(await hasReadableKey(provider))) throw new AppError(409, 'api_key_missing')
        await saveSettings({ activeEngine: provider.id, modelDownloadUse: false })
        logger.info({ engine: provider.id }, 'engine switched')
        await inOrder(publishModels)
        await queueWaiting()
      })
    },

    /** The state of a recording that was just saved. */
    initialStatus: async (): Promise<'pending' | 'skipped'> =>
      (await readSettings())?.enabled ? 'pending' : 'skipped',

    /** Queues a saved recording when the engine is ready. Otherwise it waits and is queued once the engine is ready. */
    schedule: async (recording: SavedRecording, requestId?: string, replaceEdited?: boolean) => {
      if ((await availability()).state === 'ready') await queue(recording, requestId, replaceEdited)
    },

    /** Moves recordings that were never transcribed into the queue. Returns how many. */
    transcribeBacklog: async (requestId?: string) => {
      if ((await availability()).state !== 'ready') throw new AppError(409, 'model_not_ready')
      const moved = await db
        .update(recordings)
        .set({ status: 'pending', failure: null })
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
      const engine = activeEngineOf(settings)
      const activeLocalId = engine.kind === 'local' ? engine.model.id : undefined
      if (
        settings?.downloadState === 'downloading' &&
        settings.downloadId !== null &&
        settings.downloadId !== activeLocalId
      ) {
        await saveSettings({
          modelDownloadState: 'failed',
          modelDownloadedBytes: 0,
          modelDownloadError: 'download_failed',
        })
        await storage.removeFolder(modelKey(settings.downloadId))
        logger.warn(
          { modelId: settings.downloadId, reason: 'server_stopped' },
          'model download failed',
        )
        await inOrder(publishModels)
      }
      if (settings?.enabled) await ensureActiveEngine(settings)
    },

    whenIdle: () => manager.whenIdle(),
  }
}

export type TranscriptionService = ReturnType<typeof createTranscriptionService>
