import { todayIn, type EntryLanguage } from '@nightjar/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, meQuery, uploadRecording } from '../api.ts'
import { DateDialog } from '../components/date-dialog.tsx'
import { Icon } from '../components/icon.tsx'
import { Segmented } from '../components/segmented.tsx'
import { longDate } from '../dates.ts'
import { formatDuration, formatSize } from '../format.ts'

const accepted = 'audio/*,.m4a,.aac,.mp3,.wav,.flac,.ogg,.opus,.webm'

type Phase = 'choosing' | 'ready' | 'uploading'

/** Reads the length of the file in the browser, so it can be shown before uploading. */
function useDuration(file: File | undefined) {
  const [probed, setProbed] = useState<{ file: File; seconds: number }>()
  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    const probe = new Audio()
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) setProbed({ file, seconds: probe.duration })
    }
    probe.src = url
    return () => {
      probe.onloadedmetadata = null
      URL.revokeObjectURL(url)
    }
  }, [file])
  return probed?.file === file ? probed?.seconds : undefined
}

export function UploadPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const entryId = params.get('entry') ?? undefined
  const me = useQuery(meQuery).data

  const picker = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | undefined>(undefined)
  const [file, setFile] = useState<File>()
  const [language, setLanguage] = useState<EntryLanguage>(me?.entryLanguage ?? 'en')
  const [day, setDay] = useState('')
  const [phase, setPhase] = useState<Phase>('choosing')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState<string>()
  const [pickingDay, setPickingDay] = useState(false)
  const seconds = useDuration(file)
  const timeZone = me?.timeZone ?? 'UTC'
  const today = todayIn(timeZone, new Date())

  const choose = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    setFailure(undefined)
    const modified = todayIn(timeZone, new Date(picked.lastModified))
    setDay(modified > today ? today : modified)
    setPhase('ready')
  }

  const leave = () => {
    if (location.key === 'default') void navigate('/', { replace: true })
    else void navigate(-1)
  }

  const submit = async () => {
    if (!file) return
    abort.current = new AbortController()
    setPhase('uploading')
    setProgress(0)
    setFailure(undefined)
    try {
      const recording = await uploadRecording(
        {
          file,
          filename: file.name,
          language,
          entryId,
          entryDate: entryId ? undefined : day,
        },
        { onProgress: setProgress, signal: abort.current.signal },
      )
      void queryClient.invalidateQueries({ queryKey: ['entries', recording.entryId] })
      await navigate(`/entries/${recording.entryId}`, { replace: true })
    } catch (error) {
      setPhase('ready')
      if (error instanceof DOMException) return
      setFailure(error instanceof ApiError && i18n.exists(`error.${error.code}`) ? error.code : '')
    }
  }

  const languages: { value: EntryLanguage; label: string }[] = [
    { value: 'hu', label: t('lang.hu') },
    { value: 'en', label: t('lang.en') },
    { value: 'auto', label: t('lang.auto') },
  ]
  const percent = Math.round(progress * 100)

  return (
    <>
      <div className="wr-top">
        <button type="button" className="back" onClick={leave}>
          <Icon name="back" />
          {t('common.back')}
        </button>
      </div>
      <h1 className="title">{t('upload.title')}</h1>
      <p className="lead">{entryId ? t('upload.leadExisting') : t('upload.lead')}</p>
      <input
        ref={picker}
        type="file"
        accept={accepted}
        hidden
        onChange={(event) => {
          choose(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {failure !== undefined ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{failure ? t(`error.${failure}`) : t('error.generic')}</span>
        </div>
      ) : null}
      {!file ? (
        <div
          className="drop"
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            choose(event.dataTransfer.files[0])
          }}
        >
          <Icon name="upload" />
          <p>{t('upload.drop')}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              picker.current?.click()
            }}
          >
            {t('upload.choose')}
          </button>
        </div>
      ) : (
        <>
          <div className="file">
            <span className="fi">
              <Icon name="file" />
            </span>
            <div className="fn">
              <b>{file.name}</b>
              <small>
                {phase === 'uploading'
                  ? t('upload.progress', { pct: percent })
                  : [
                      formatSize(file.size, i18n.language === 'hu' ? 'hu' : 'en'),
                      seconds === undefined ? undefined : formatDuration(seconds * 1000),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </small>
              {phase === 'uploading' ? (
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('upload.submit')}
                >
                  <i style={{ width: `${String(percent)}%` }} />
                </div>
              ) : null}
            </div>
            {phase === 'ready' ? (
              <button
                type="button"
                className="btn text"
                onClick={() => {
                  picker.current?.click()
                }}
              >
                {t('upload.replace')}
              </button>
            ) : null}
          </div>
          <div className="field">
            <div className="fl" id="upload-language">
              {t('upload.language')}
            </div>
            <Segmented
              name="uploadLanguage"
              labelledBy="upload-language"
              options={languages}
              value={language}
              onChange={setLanguage}
            />
          </div>
          {entryId ? null : (
            <div className="field">
              <div className="fl">{t('upload.whichDay')}</div>
              <button
                type="button"
                className="chip"
                disabled={phase === 'uploading'}
                onClick={() => {
                  setPickingDay(true)
                }}
              >
                <Icon name="cal" />
                {longDate(day, i18n.language)}
              </button>
            </div>
          )}
          <div className="actions">
            {phase === 'ready' ? (
              <button type="button" className="btn block" onClick={() => void submit()}>
                {t('upload.submit')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn line block"
              onClick={() => {
                if (phase === 'uploading') abort.current?.abort()
                else leave()
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
      {pickingDay ? (
        <DateDialog
          value={day}
          today={today}
          onCancel={() => {
            setPickingDay(false)
          }}
          onConfirm={(picked) => {
            setDay(picked)
            setPickingDay(false)
          }}
        />
      ) : null}
    </>
  )
}
