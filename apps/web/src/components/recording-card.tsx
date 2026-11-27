import type { Recording } from '@nightjar/shared/recordings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audioUrl, entryRecordingsQuery, meQuery, retryRecording, saveTranscript } from '../api.ts'
import { clockTime } from '../dates.ts'
import { formatDuration } from '../format.ts'
import { Icon } from './icon.tsx'

function Player({ recording }: { recording: Recording }) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const length = recording.durationMs / 1000

  const toggle = () => {
    const element = audio.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }

  return (
    <div className="player">
      <audio
        ref={audio}
        src={audioUrl(recording.id)}
        preload="metadata"
        onPlay={() => {
          setPlaying(true)
        }}
        onPause={() => {
          setPlaying(false)
        }}
        onEnded={() => {
          setPlaying(false)
          setPosition(0)
        }}
        onTimeUpdate={(event) => {
          setPosition(event.currentTarget.currentTime)
        }}
      />
      <button
        type="button"
        className="pl"
        aria-label={playing ? t('player.pause') : t('player.play')}
        onClick={toggle}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <input
        type="range"
        className="track"
        aria-label={t('player.seek')}
        min={0}
        max={length}
        step={0.1}
        value={Math.min(position, length)}
        onChange={(event) => {
          const target = Number(event.target.value)
          if (audio.current) audio.current.currentTime = target
          setPosition(target)
        }}
      />
      <span className="time">
        {formatDuration(position * 1000)} / {formatDuration(recording.durationMs)}
      </span>
    </div>
  )
}

function Transcript({ recording }: { recording: Recording }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const listKey = entryRecordingsQuery(recording.entryId).queryKey

  const replace = (changed: Recording) => {
    queryClient.setQueryData<Recording[]>(listKey, (list) =>
      list?.map((item) => (item.id === changed.id ? changed : item)),
    )
  }

  const retry = useMutation({ mutationFn: () => retryRecording(recording.id), onSuccess: replace })
  const save = useMutation({
    mutationFn: () => saveTranscript(recording.id, draft),
    onSuccess: (transcript) => {
      replace({ ...recording, transcript })
      setEditing(false)
    },
  })

  const time = clockTime(new Date(recording.createdAt), timeZone, i18n.language)
  const spoken =
    recording.transcript?.language ??
    (recording.language === 'auto' ? undefined : recording.language)
  const tags = (
    <div className="tag">
      {spoken ? <span>{t(`lang.${spoken}`)}</span> : null}
      <span>{time}</span>
      {recording.status === 'done' && !editing ? (
        <button
          type="button"
          className="btn text"
          onClick={() => {
            setDraft(recording.transcript?.text ?? '')
            setEditing(true)
          }}
        >
          <Icon name="pen" />
          {t('transcript.edit')}
        </button>
      ) : null}
    </div>
  )

  if (recording.status === 'pending' || recording.status === 'transcribing') {
    return (
      <>
        <div className="working" role="status">
          <Icon name="bird" />
          {t('transcript.working')}
        </div>
        <div className="sk" style={{ width: '100%' }} />
        <div className="sk" style={{ width: '82%' }} />
        <div className="sk" style={{ width: '55%' }} />
      </>
    )
  }

  if (recording.status === 'failed') {
    return (
      <>
        <div className="failed" role="alert">
          <Icon name="alert" />
          <div>
            <b>{t('transcript.failed')}</b>
            <p>{t('transcript.failedText')}</p>
            <button
              type="button"
              className="btn sm ghost"
              disabled={retry.isPending}
              onClick={() => {
                retry.mutate()
              }}
            >
              <Icon name="retry" />
              {t('common.retry')}
            </button>
          </div>
        </div>
        {tags}
      </>
    )
  }

  if (recording.status === 'skipped') {
    return (
      <>
        <div className="offnote">
          <Icon name="info" />
          <div>
            <b>{t('transcript.off')}</b>
            <p>{t('transcript.offText')}</p>
          </div>
        </div>
        {tags}
      </>
    )
  }

  if (editing) {
    return (
      <>
        <textarea
          className="edit"
          aria-label={t('transcript.edit')}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
        />
        {save.isError ? (
          <div className="alert" role="alert">
            <Icon name="alert" />
            <span>{t('transcript.saveFailed')}</span>
          </div>
        ) : null}
        <div className="editbtns">
          <button
            type="button"
            className="btn sm"
            disabled={save.isPending}
            onClick={() => {
              save.mutate()
            }}
          >
            {t('transcript.save')}
          </button>
          <button
            type="button"
            className="btn sm line"
            onClick={() => {
              save.reset()
              setEditing(false)
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
        <p className="editnote">{t('transcript.editNote')}</p>
      </>
    )
  }

  return (
    <>
      <p className="tr" data-testid="transcript">
        {recording.transcript?.text}
      </p>
      {tags}
    </>
  )
}

export function RecordingCard({ recording }: { recording: Recording }) {
  return (
    <div className="rcard" data-testid="recording-card">
      <Player recording={recording} />
      <Transcript recording={recording} />
    </div>
  )
}
