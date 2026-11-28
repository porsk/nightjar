import { todayIn } from '@nightjar/shared'
import { maxRecordingMs } from '@nightjar/shared/recordings'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, meQuery, uploadRecording } from '../api.ts'
import { Dialog } from '../components/dialog.tsx'
import { Icon } from '../components/icon.tsx'
import { formatTimer } from '../format.ts'

type Phase = 'recording' | 'paused' | 'blocked' | 'saving' | 'failed'

const barCount = 48
const meterIntervalMs = 80
const timerIntervalMs = 200

const preferredTypes = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

const extensionFor = (mimeType: string) => {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

interface Session {
  stream: MediaStream
  recorder: MediaRecorder
  context: AudioContext | undefined
  wakeLock: WakeLockSentinel | undefined
  chunks: Blob[]
  meter: ReturnType<typeof setInterval>
  clock: { accumulated: number; startedAt: number | undefined }
}

const elapsedOf = (clock: Session['clock']) =>
  clock.accumulated + (clock.startedAt === undefined ? 0 : performance.now() - clock.startedAt)

/** Starts the microphone, the level meter and the wake lock, and records in the browser. */
async function openSession(onLevel: (level: number) => void): Promise<Session> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Uint8Array(analyser.fftSize)
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2
    onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4))
  }, meterIntervalMs)

  const wakeLock =
    'wakeLock' in navigator
      ? await navigator.wakeLock.request('screen').catch(() => undefined)
      : undefined
  recorder.start(1000)
  return {
    stream,
    recorder,
    context,
    wakeLock,
    chunks,
    meter,
    clock: { accumulated: 0, startedAt: performance.now() },
  }
}

function closeSession(session: Session) {
  clearInterval(session.meter)
  for (const track of session.stream.getTracks()) track.stop()
  void session.context?.close()
  void session.wakeLock?.release()
}

export function RecorderPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const me = useQuery(meQuery).data
  const entryId = params.get('entry') ?? undefined

  const [phase, setPhase] = useState<Phase>('recording')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array<number>(barCount).fill(0))
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState(0)
  const [limitReached, setLimitReached] = useState(false)
  const stopRef = useRef<() => Promise<void>>(undefined)
  const session = useRef<Session | undefined>(undefined)
  const saved = useRef<Blob | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    openSession((level) => {
      setLevels((previous) => [...previous.slice(1), level])
    }).then(
      (opened) => {
        if (cancelled) closeSession(opened)
        else session.current = opened
      },
      () => {
        if (!cancelled) setPhase('blocked')
      },
    )
    const timer = setInterval(() => {
      if (!session.current) return
      const spent = elapsedOf(session.current.clock)
      setElapsed(spent)
      if (spent >= maxRecordingMs) {
        setLimitReached(true)
        void stopRef.current?.()
      }
    }, timerIntervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
      const open = session.current
      session.current = undefined
      if (open) {
        if (open.recorder.state !== 'inactive') open.recorder.stop()
        closeSession(open)
      }
    }
  }, [])

  const leave = useCallback(() => {
    if (location.key === 'default') void navigate('/', { replace: true })
    else void navigate(-1)
  }, [location.key, navigate])

  const upload = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!me) return
      setPhase('saving')
      setProgress(0)
      try {
        const recording = await uploadRecording(
          {
            file: blob,
            filename: `recording.${extensionFor(mimeType)}`,
            language: me.entryLanguage,
            entryId,
            entryDate: entryId ? undefined : todayIn(me.timeZone, new Date()),
          },
          { onProgress: setProgress },
        )
        void queryClient.invalidateQueries({ queryKey: ['entries', recording.entryId] })
        await navigate(`/entries/${recording.entryId}`, { replace: true })
      } catch (error) {
        if (!(error instanceof ApiError) && !(error instanceof DOMException)) throw error
        setPhase('failed')
      }
    },
    [me, entryId, navigate, queryClient],
  )

  const stop = async () => {
    const open = session.current
    if (!open) return
    session.current = undefined
    setElapsed(elapsedOf(open.clock))
    const finished = new Promise<void>((resolve) => {
      open.recorder.onstop = () => {
        resolve()
      }
    })
    open.recorder.stop()
    await finished
    closeSession(open)
    const mimeType = open.recorder.mimeType || 'audio/webm'
    saved.current = new Blob(open.chunks, { type: mimeType })
    await upload(saved.current, mimeType)
  }

  useEffect(() => {
    stopRef.current = stop
  })

  const togglePause = () => {
    const open = session.current
    if (!open) return
    if (phase === 'recording') {
      open.recorder.pause()
      open.clock.accumulated = elapsedOf(open.clock)
      open.clock.startedAt = undefined
      setPhase('paused')
    } else {
      open.recorder.resume()
      open.clock.startedAt = performance.now()
      setPhase('recording')
    }
    setElapsed(elapsedOf(open.clock))
  }

  const discard = () => {
    const open = session.current
    session.current = undefined
    if (open) {
      open.recorder.ondataavailable = null
      open.recorder.stop()
      closeSession(open)
    }
    leave()
  }

  if (phase === 'blocked') {
    return (
      <div className="rec-screen">
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t('recorder.micBlocked')}</span>
        </div>
        <button type="button" className="back" onClick={leave}>
          <Icon name="back" />
          {t('common.back')}
        </button>
      </div>
    )
  }

  const active = phase === 'recording' || phase === 'paused'
  return (
    <div className="rec-screen">
      <h1 className="visually-hidden">{t('nav.newRecording')}</h1>
      <div className="rec-head">
        <span className="state">
          {phase === 'recording' ? <b aria-hidden="true" /> : null}
          {phase === 'paused' ? t('recorder.paused') : t('recorder.recording')}
        </span>
      </div>
      <div className="timer" role="timer" aria-label={t('recorder.elapsed')}>
        {formatTimer(elapsed)}
      </div>
      <p className="sub">{t('recorder.calm')}</p>
      <div className="meter" aria-hidden="true" data-testid="meter">
        {levels.map((level, index) => (
          <span key={index} style={{ height: `${String(8 + Math.round(level * 100))}px` }} />
        ))}
      </div>
      {phase === 'failed' ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t('recorder.uploadFailed')}</span>
          <button
            type="button"
            className="btn sm line"
            onClick={() => {
              if (saved.current) void upload(saved.current, saved.current.type)
            }}
          >
            <Icon name="retry" />
            {t('common.retry')}
          </button>
        </div>
      ) : null}
      {limitReached ? (
        <p className="sub" role="status">
          {t('recorder.limitReached')}
        </p>
      ) : null}
      {phase === 'saving' ? (
        <p className="sub" role="status">
          {t('upload.progress', { pct: Math.round(progress * 100) })}
        </p>
      ) : null}
      <div className="ctrls">
        <button
          type="button"
          className="ctrl del"
          disabled={!active}
          onClick={() => {
            setConfirming(true)
          }}
        >
          <span className="c">
            <Icon name="trash" />
          </span>
          {t('recorder.discard')}
        </button>
        <button type="button" className="ctrl stop" disabled={!active} onClick={() => void stop()}>
          <span className="c">
            <Icon name="stop" />
          </span>
          {t('recorder.stop')}
        </button>
        <button type="button" className="ctrl" disabled={!active} onClick={togglePause}>
          <span className="c">
            <Icon name={phase === 'paused' ? 'play' : 'pause'} />
          </span>
          {phase === 'paused' ? t('recorder.resume') : t('recorder.pause')}
        </button>
      </div>
      {confirming ? (
        <Dialog
          role="alertdialog"
          title={t('recorder.discardConfirm.title')}
          onClose={() => {
            setConfirming(false)
          }}
        >
          <p>{t('recorder.discardConfirm.text')}</p>
          <div className="actions">
            <button type="button" className="btn danger block" onClick={discard}>
              {t('recorder.discard')}
            </button>
            <button
              type="button"
              className="btn line block"
              data-autofocus
              onClick={() => {
                setConfirming(false)
              }}
            >
              {t('recorder.discardConfirm.keep')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
