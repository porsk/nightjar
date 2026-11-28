import type { ModelStatus, ProviderStatus, TranscriptionStatus } from '@nightjar/shared/recordings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteModel,
  downloadModel,
  setTranscription,
  transcribeBacklog,
  transcriptionQuery,
  useModel,
  useProvider,
} from '../api.ts'
import { formatModelSize } from '../format.ts'
import { Dialog } from './dialog.tsx'
import { Icon } from './icon.tsx'
import { ProviderRow, RemoveKeyDialog, providerName } from './provider-row.tsx'
import { useErrorText } from './use-error-text.ts'

const megabytes = (bytes: number) => `${String(Math.round(bytes / 1_000_000))}\u00a0MB`

interface RowProps {
  model: ModelStatus
  active: boolean
  anyDownloading: boolean
  busy: boolean
  onDownload: () => void
  onUse: () => void
  onDelete: () => void
}

function ModelRow({ model, active, anyDownloading, busy, onDownload, onUse, onDelete }: RowProps) {
  const { t, i18n } = useTranslation()
  const inUse = active && model.state === 'downloaded'
  const known = i18n.exists(`models.${model.id}.name`)
  const name = known ? t(`models.${model.id}.name`) : model.id
  const percent =
    model.downloadBytes > 0 ? Math.floor((model.downloadedBytes / model.downloadBytes) * 100) : 0
  const notDownloaded = model.state === 'not_downloaded'
  const blocked = busy || anyDownloading

  return (
    <div className={inUse ? 'mrow on' : 'mrow'} data-testid="model-row">
      <div className="mh">
        <span className="nm">
          <Icon name="chip" />
          <b>{name}</b>
        </span>
        {inUse ? (
          <span className="mstate on">
            <Icon name="check" />
            {t('settings.models.inUse')}
          </span>
        ) : model.state === 'downloaded' ? (
          <span className="mstate">{t('settings.models.downloaded')}</span>
        ) : model.state === 'downloading' ? null : (
          <span className="mstate">{t('settings.models.notDownloaded')}</span>
        )}
      </div>
      {known ? <p className="mdesc">{t(`models.${model.id}.description`)}</p> : null}
      <p className="msize">
        {t('settings.models.size', {
          size: formatModelSize(model.downloadBytes, i18n.language === 'hu' ? 'hu' : 'en'),
        })}
      </p>
      {model.state === 'downloading' ? (
        <>
          <div className="dl" role="status">
            <div className="line1">
              <span>{t('settings.model.downloading')}</span>
              <span className="num">
                {t('settings.model.progress', {
                  done: megabytes(model.downloadedBytes),
                  total: megabytes(model.downloadBytes),
                  pct: percent,
                })}
              </span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('settings.model.downloading')}
            >
              <i style={{ width: `${String(percent)}%` }} />
            </div>
          </div>
          {model.useWhenReady ? <p className="then">{t('settings.models.useAfter')}</p> : null}
        </>
      ) : null}
      {model.state === 'failed' ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <div className="ab">
            <span>
              {model.error === 'disk_full'
                ? t('settings.models.diskFull')
                : t('settings.model.failed')}
            </span>
            <button
              type="button"
              className="btn sm line"
              disabled={blocked}
              onClick={model.useWhenReady ? onUse : onDownload}
            >
              <Icon name="retry" />
              {t('common.retry')}
            </button>
          </div>
        </div>
      ) : null}
      {notDownloaded ? (
        <div className="macts">
          <button type="button" className="btn sm" disabled={blocked} onClick={onUse}>
            {t('settings.models.use')}
          </button>
          <button type="button" className="btn sm line" disabled={blocked} onClick={onDownload}>
            {t('settings.models.download')}
          </button>
        </div>
      ) : null}
      {model.state === 'downloaded' && !inUse ? (
        <div className="macts">
          <button type="button" className="btn sm" disabled={busy} onClick={onUse}>
            {t('settings.models.use')}
          </button>
          <button type="button" className="btn textdanger" onClick={onDelete}>
            <Icon name="trash" />
            {t('settings.models.delete')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function DeleteModelDialog({
  model,
  onDone,
  onCancel,
}: {
  model: ModelStatus
  onDone: (status: TranscriptionStatus) => void
  onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const errorText = useErrorText()
  const remove = useMutation({ mutationFn: () => deleteModel(model.id), onSuccess: onDone })
  const name = i18n.exists(`models.${model.id}.name`) ? t(`models.${model.id}.name`) : model.id
  return (
    <Dialog
      role="alertdialog"
      title={t('settings.models.deleteTitle', { name })}
      onClose={onCancel}
    >
      <p>
        {t('settings.models.deleteText', {
          size: formatModelSize(model.diskBytes, i18n.language === 'hu' ? 'hu' : 'en'),
        })}
      </p>
      {remove.isError ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{errorText(remove.error)}</span>
        </div>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="btn danger block"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate()
          }}
        >
          {t('settings.models.delete')}
        </button>
        <button type="button" className="btn line block" data-autofocus onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  )
}

/** The admin block of Settings: switch transcription on, choose the engine, manage cloud keys, queue old recordings. */
export function TranscriptionSettings() {
  const { t, i18n } = useTranslation()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const status = useQuery(transcriptionQuery)
  const [askHidden, setAskHidden] = useState(false)
  const [deleting, setDeleting] = useState<ModelStatus>()
  const [removingKey, setRemovingKey] = useState<ProviderStatus>()

  const keep = (next: TranscriptionStatus) => {
    queryClient.setQueryData(transcriptionQuery.queryKey, next)
  }
  const toggle = useMutation({ mutationFn: setTranscription, onSuccess: keep })
  const download = useMutation({ mutationFn: downloadModel, onSuccess: keep })
  const use = useMutation({ mutationFn: useModel, onSuccess: keep })
  const useCloud = useMutation({ mutationFn: useProvider, onSuccess: keep })
  const backlog = useMutation({
    mutationFn: transcribeBacklog,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transcriptionQuery.queryKey }),
  })

  if (!status.data) return null
  const language = i18n.language === 'hu' ? 'hu' : 'en'
  const { enabled, state, totalBytes, backlogCount, activeEngine, models, providers, usage } =
    status.data
  const anyDownloading = models.some((model) => model.state === 'downloading')
  const failure = [download, use, useCloud].find((mutation) => mutation.isError)?.error
  const activeProvider = providers.find((provider) => provider.id === activeEngine)
  const activeName = activeProvider
    ? providerName(t, (key) => i18n.exists(key), activeProvider)
    : undefined
  const busy = download.isPending || use.isPending || useCloud.isPending

  return (
    <>
      <h2 className="sec">{t('settings.admin')}</h2>
      <div className="group">
        <div className="srow">
          <div className="trow">
            <div>
              <b id="transcription-label">{t('settings.transcription')}</b>
              <p>
                {activeName
                  ? t('settings.transcriptionHintCloud', { engine: activeName })
                  : t('settings.transcriptionHint', {
                      size: formatModelSize(totalBytes, language),
                    })}
              </p>
            </div>
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={enabled}
              aria-labelledby="transcription-label"
              disabled={toggle.isPending}
              onClick={() => {
                toggle.mutate(!enabled)
              }}
            />
          </div>
          {state === 'needs_key' ? (
            <div className="okline">
              <Icon name="alert" />
              {t('settings.engines.needsKey')}
            </div>
          ) : null}
          {state === 'ready' ? (
            <>
              <div className="okline">
                <Icon name={activeName ? 'cloud' : 'check'} />
                {activeName
                  ? t('settings.engines.cloudReady', { engine: activeName })
                  : t('settings.model.ready')}
              </div>
              {backlogCount > 0 && !askHidden ? (
                <div className="ask">
                  <b>{t('settings.backlog.question', { count: backlogCount })}</b>
                  <div className="acts">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={backlog.isPending}
                      onClick={() => {
                        backlog.mutate()
                      }}
                    >
                      {t('settings.backlog.now')}
                    </button>
                    <button
                      type="button"
                      className="btn sm line"
                      onClick={() => {
                        setAskHidden(true)
                      }}
                    >
                      {t('settings.backlog.later')}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {enabled ? (
          <div className="srow">
            <div className="fl" id="engines-label">
              {t('settings.engines.title')}
            </div>
            <div className="egroup" role="group" aria-labelledby="engines-local">
              <div className="eg-h" id="engines-local">
                <Icon name="chip" />
                {t('settings.engines.local')}
              </div>
              {models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  active={model.id === activeEngine}
                  anyDownloading={anyDownloading}
                  busy={busy}
                  onDownload={() => {
                    download.mutate(model.id)
                  }}
                  onUse={() => {
                    use.mutate(model.id)
                  }}
                  onDelete={() => {
                    setDeleting(model)
                  }}
                />
              ))}
            </div>
            <div className="egroup" role="group" aria-labelledby="engines-cloud">
              <div className="eg-h" id="engines-cloud">
                <Icon name="cloud" />
                {t('settings.engines.cloud')}
              </div>
              <p className="eg-hint">{t('settings.engines.cloudHint')}</p>
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  usage={usage.find((item) => item.engine === provider.id)}
                  active={provider.id === activeEngine}
                  busy={busy}
                  onSaved={keep}
                  onUse={() => {
                    useCloud.mutate(provider.id)
                  }}
                  onRemove={() => {
                    setRemovingKey(provider)
                  }}
                />
              ))}
            </div>
            {failure ? (
              <div className="alert" role="alert">
                <Icon name="alert" />
                <span>{errorText(failure)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {deleting ? (
        <DeleteModelDialog
          model={deleting}
          onDone={(next) => {
            keep(next)
            setDeleting(undefined)
          }}
          onCancel={() => {
            setDeleting(undefined)
          }}
        />
      ) : null}
      {removingKey ? (
        <RemoveKeyDialog
          provider={removingKey}
          onDone={(next) => {
            keep(next)
            setRemovingKey(undefined)
          }}
          onCancel={() => {
            setRemovingKey(undefined)
          }}
        />
      ) : null}
    </>
  )
}
