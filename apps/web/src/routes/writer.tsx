import { todayIn, type Entry } from '@nightjar/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { createEntry, deleteEntry, entryQuery, meQuery, updateEntry } from '../api.ts'
import { DateDialog } from '../components/date-dialog.tsx'
import { DeleteDialog } from '../components/delete-dialog.tsx'
import { Icon } from '../components/icon.tsx'
import { clockTime, dateLabel } from '../dates.ts'
import { EntryError } from './entry.tsx'

const autosaveDelayMs = 1000

type Status = { kind: 'idle' } | { kind: 'saved'; time: string } | { kind: 'failed' }

export function WriterPage() {
  const { id } = useParams()
  const entry = useQuery({ ...entryQuery(id ?? ''), enabled: Boolean(id) })
  if (id && !entry.data) return entry.isError ? <EntryError error={entry.error} /> : null
  return <Writer initial={entry.data} />
}

function Writer({ initial }: { initial: Entry | undefined }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const today = todayIn(timeZone, new Date())

  const [isNew] = useState(!initial)
  const [text, setText] = useState(initial?.bodyMd ?? '')
  const [day, setDay] = useState(initial?.entryDate ?? today)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [dialog, setDialog] = useState<'date' | 'delete' | null>(null)

  const entryId = useRef(initial?.id)
  const latest = useRef({ text, day })
  const saved = useRef({ text: initial?.bodyMd, day: initial?.entryDate })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const mounted = useRef(false)
  const deleted = useRef(false)
  const leaving = useRef(false)

  const persist = async (): Promise<boolean> => {
    if (deleted.current) return true
    const draft = latest.current
    try {
      const id = entryId.current
      if (!id) {
        if (draft.text === '') return true
        const created = await createEntry({ bodyMd: draft.text, entryDate: draft.day })
        entryId.current = created.id
        queryClient.setQueryData(entryQuery(created.id).queryKey, created)
        if (mounted.current && !leaving.current)
          void navigate(`/entries/${created.id}/edit`, { replace: true })
      } else {
        const changes = {
          ...(draft.text !== saved.current.text ? { bodyMd: draft.text } : {}),
          ...(draft.day !== saved.current.day ? { entryDate: draft.day } : {}),
        }
        if (Object.keys(changes).length === 0) return true
        queryClient.setQueryData(entryQuery(id).queryKey, await updateEntry(id, changes))
      }
      saved.current = { text: draft.text, day: draft.day }
      setStatus({ kind: 'saved', time: clockTime(new Date(), timeZone, i18n.language) })
      return true
    } catch {
      setStatus({ kind: 'failed' })
      return false
    }
  }

  const save = () => {
    const result = queue.current.then(persist)
    queue.current = result
    return result
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
      void save()
    }
    // runs once: the cleanup flushes what is still unsaved, through refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (next: Partial<typeof latest.current>) => {
    latest.current = { ...latest.current, ...next }
    clearTimeout(timer.current)
    if (next.text !== undefined) timer.current = setTimeout(() => void save(), autosaveDelayMs)
    else if (entryId.current) void save()
  }

  const finish = async () => {
    clearTimeout(timer.current)
    leaving.current = true
    const done = await save()
    leaving.current = false
    if (!done) return
    await navigate(entryId.current ? `/entries/${entryId.current}` : '/', { replace: true })
  }

  const remove = async () => {
    const id = entryId.current
    if (id) {
      await deleteEntry(id)
      queryClient.removeQueries({ queryKey: entryQuery(id).queryKey })
    }
    deleted.current = true
    await navigate('/', { replace: true })
  }

  return (
    <>
      <div className="wr-top">
        <button type="button" className="back" onClick={() => void finish()}>
          <Icon name="back" />
          {t('common.back')}
        </button>
        <button type="button" className="btn sm" onClick={() => void finish()}>
          {t('writer.done')}
        </button>
      </div>
      <h1 className="title wr-title">{t(isNew ? 'writer.newTitle' : 'writer.editTitle')}</h1>
      <button
        type="button"
        className="chip"
        onClick={() => {
          setDialog('date')
        }}
      >
        <Icon name="cal" />
        {dateLabel(day, today, i18n.language, t)}
      </button>
      <textarea
        className="paper"
        aria-label={t('writer.textLabel')}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          change({ text: event.target.value })
        }}
      />
      <div className="wr-foot">
        {status.kind === 'failed' ? (
          <span className="saved failed" role="alert">
            <Icon name="alert" />
            {t('writer.saveFailed')}
            <button type="button" className="btn text" onClick={() => void save()}>
              {t('common.retry')}
            </button>
          </span>
        ) : (
          <span className="saved" role="status">
            {status.kind === 'saved' ? (
              <>
                <Icon name="check" />
                {t('writer.savedAt', { time: status.time })}
              </>
            ) : null}
          </span>
        )}
        <span className="saved">{t('writer.markdownHint')}</span>
      </div>
      {isNew ? null : (
        <div className="actions">
          <button
            type="button"
            className="btn dangerline block"
            onClick={() => {
              setDialog('delete')
            }}
          >
            <Icon name="trash" />
            {t('entry.deleteEntry')}
          </button>
        </div>
      )}
      {dialog === 'date' ? (
        <DateDialog
          value={day}
          today={today}
          onCancel={() => {
            setDialog(null)
          }}
          onConfirm={(picked) => {
            setDialog(null)
            setDay(picked)
            change({ day: picked })
          }}
        />
      ) : null}
      {dialog === 'delete' ? (
        <DeleteDialog
          onCancel={() => {
            setDialog(null)
          }}
          onConfirm={remove}
        />
      ) : null}
    </>
  )
}
