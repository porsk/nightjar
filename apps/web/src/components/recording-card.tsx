import type { Recording } from '@nightjar/shared/recordings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  audioUrl,
  entryRecordingsQuery,
  meQuery,
  retranscribeRecording,
  retryRecording,
  saveTranscript,
  transcriptionAvailabilityQuery,
} from '../api.ts'
import { clockTime } from '../dates.ts'
import { formatDuration } from '../format.ts'
import { Dialog } from './dialog.tsx'
import { Icon } from './icon.tsx'
import { useErrorText } from './use-error-text.ts'

const isBusy = (recording: Recording) =>
  recording.status === 'pending' || recording.status === 'transcribing'

/** Everything the card needs to transcribe a recording again, including the confirm for edited text. */
function useTranscribeAgain(recording: Recording) {
  const queryClient = useQueryClient()
  const listKey = entryRecordingsQuery(recording.entryId).queryKey
  const [confirming, setConfirming] = useState(false)
  const mutation = useMutation({
    mutationFn: (replaceEdited: boolean) => retranscribeRecording(recording.id, replaceEdited),
    onSuccess: (changed) => {
      queryClient.setQueryData<Recording[]>(listKey, (list) =>
        list?.map((item) => (item.id === changed.id ? changed : item)),
      )
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: listKey })
      }
    },
  })
  return {
    mutation,
    confirming,
    cancelConfirm: () => {
      setConfirming(false)
    },
    confirm: () => {
      setConfirming(false)
      mutation.mutate(true)
    },
    request: () => {
      if (recording.transcript?.isUserEdited) setConfirming(true)
      else mutation.mutate(false)
    },
  }
}

type TranscribeAgain = ReturnType<typeof useTranscribeAgain>

function RecordingMenu({ recording, onAgain }: { recording: Recording; onAgain: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const availability = useQuery({ ...transcriptionAvailabilityQuery, enabled: open }).data?.state

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    item.current?.focus()
    const onOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('click', onOutsideClick)
    return () => {
      document.removeEventListener('click', onOutsideClick)
    }
  }, [open])

  const loading = availability === undefined
  const hint =
    availability === 'off'
      ? t('recording.againOff')
      : availability === 'not_ready'
        ? t('recording.againNoModel')
        : isBusy(recording)
          ? t('recording.againRunning')
          : undefined

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icbtn more"
        aria-label={t('recording.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div
          ref={menu}
          className="menu"
          role="menu"
          aria-label={t('recording.menu')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            } else if (event.key === 'Tab') {
              setOpen(false)
            }
          }}
        >
          <button
            ref={item}
            type="button"
            role="menuitem"
            className="mi"
            aria-disabled={hint || loading ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
            onClick={() => {
              if (hint || loading) return
              close()
              onAgain()
            }}
          >
            <Icon name="retry" />
            <span>
              <span className="ml">{t('recording.transcribeAgain')}</span>
              {hint ? <small id={hintId}>{hint}</small> : null}
            </span>
          </button>
        </div>
      ) : null}
    </>
  )
}

function Player({ recording, menu }: { recording: Recording; menu: ReactNode }) {
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
      {menu}
    </div>
  )
}

function Transcript({ recording, again }: { recording: Recording; again: TranscribeAgain }) {
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

  const { transcript, status } = recording
  const busy = isBusy(recording)
  const time = clockTime(new Date(recording.createdAt), timeZone, i18n.language)
  const spoken =
    transcript?.language ?? (recording.language === 'auto' ? undefined : recording.language)
  const modelKnown = transcript !== null && i18n.exists(`models.${transcript.model}.name`)
  const canEdit = transcript !== null && !busy && !editing
  const tags = (
    <div className="tag">
      {spoken ? <span>{t(`lang.${spoken}`)}</span> : null}
      <span>{time}</span>
      {modelKnown ? (
        <span className="mdl">
          <span className="visually-hidden">{t('transcript.modelPrefix')} </span>
          {t(`models.${transcript.model}.name`)}
        </span>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className="btn text"
          onClick={() => {
            setDraft(transcript.text)
            setEditing(true)
          }}
        >
          <Icon name="pen" />
          {t('transcript.edit')}
        </button>
      ) : null}
    </div>
  )

  if (transcript === null && busy) {
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

  if (transcript === null && status === 'failed') {
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

  if (transcript === null && status === 'skipped') {
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
      {busy ? (
        <div className="working" role="status">
          <Icon name="bird" />
          {t('transcript.reworking')}
        </div>
      ) : null}
      {status === 'failed' ? (
        <div className="failed" role="alert">
          <Icon name="alert" />
          <div>
            <b>{t('transcript.againFailed')}</b>
            <p>{t('transcript.againFailedText')}</p>
            <button
              type="button"
              className="btn sm ghost"
              disabled={again.mutation.isPending}
              onClick={again.request}
            >
              <Icon name="retry" />
              {t('common.retry')}
            </button>
          </div>
        </div>
      ) : null}
      <p className={busy ? 'tr old' : 'tr'} data-testid="transcript">
        {transcript?.text}
      </p>
      {tags}
    </>
  )
}

export function RecordingCard({ recording }: { recording: Recording }) {
  const { t } = useTranslation()
  const errorText = useErrorText()
  const again = useTranscribeAgain(recording)
  return (
    <div className="rcard" data-testid="recording-card">
      <Player
        recording={recording}
        menu={<RecordingMenu recording={recording} onAgain={again.request} />}
      />
      {again.mutation.isError ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{errorText(again.mutation.error)}</span>
        </div>
      ) : null}
      <Transcript recording={recording} again={again} />
      {again.confirming ? (
        <Dialog
          role="alertdialog"
          title={t('recording.replaceTitle')}
          onClose={again.cancelConfirm}
        >
          <p>{t('recording.replaceText')}</p>
          <div className="actions">
            <button type="button" className="btn danger block" onClick={again.confirm}>
              {t('recording.transcribeAgain')}
            </button>
            <button
              type="button"
              className="btn line block"
              data-autofocus
              onClick={again.cancelConfirm}
            >
              {t('common.cancel')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
