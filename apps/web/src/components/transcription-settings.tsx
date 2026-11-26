import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setTranscription, transcribeBacklog, transcriptionQuery } from '../api.ts'
import { Icon } from './icon.tsx'

const megabytes = (bytes: number) => `${String(Math.round(bytes / 1_000_000))} MB`

/** The admin block of Settings: switch transcription on, watch the model download, queue old recordings. */
export function TranscriptionSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const status = useQuery(transcriptionQuery)
  const [askHidden, setAskHidden] = useState(false)

  const toggle = useMutation({
    mutationFn: setTranscription,
    onSuccess: (next) => {
      queryClient.setQueryData(transcriptionQuery.queryKey, next)
    },
  })
  const backlog = useMutation({
    mutationFn: transcribeBacklog,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transcriptionQuery.queryKey }),
  })

  if (!status.data) return null
  const { enabled, state, downloadedBytes, totalBytes, backlogCount } = status.data
  const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0

  return (
    <>
      <h2 className="sec">{t('settings.admin')}</h2>
      <div className="group">
        <div className="srow">
          <div className="trow">
            <div>
              <b id="transcription-label">{t('settings.transcription')}</b>
              <p>{t('settings.transcriptionHint', { size: megabytes(totalBytes) })}</p>
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
          {state === 'downloading' ? (
            <div className="dl" role="status">
              <div className="line1">
                <span>{t('settings.model.downloading')}</span>
                <span className="num">
                  {t('settings.model.progress', {
                    done: megabytes(downloadedBytes),
                    total: megabytes(totalBytes),
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
          ) : null}
          {state === 'failed' ? (
            <div className="alert dl" role="alert">
              <Icon name="alert" />
              <span>{t('settings.model.failed')}</span>
              <button
                type="button"
                className="btn sm line"
                onClick={() => {
                  toggle.mutate(true)
                }}
              >
                <Icon name="retry" />
                {t('common.retry')}
              </button>
            </div>
          ) : null}
          {state === 'ready' ? (
            <>
              <div className="okline">
                <Icon name="check" />
                {t('settings.model.ready')}
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
      </div>
    </>
  )
}
