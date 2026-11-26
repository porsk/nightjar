import { todayIn } from '@nightjar/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  ApiError,
  deleteEntry,
  entryQuery,
  entryRecordingsQuery,
  meQuery,
  updateEntry,
} from '../api.ts'
import { DateDialog } from '../components/date-dialog.tsx'
import { DeleteDialog } from '../components/delete-dialog.tsx'
import { Icon } from '../components/icon.tsx'
import { RecordingCard } from '../components/recording-card.tsx'
import { TimelineList } from '../components/timeline-list.tsx'
import { longDate } from '../dates.ts'
import { renderMarkdown } from '../markdown.ts'
import { useMediaQuery } from '../use-media-query.ts'
import { ErrorNotice } from '../components/error-notice.tsx'

export function EntryError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const notFound = error instanceof ApiError && error.status === 404
  return <ErrorNotice message={t(notFound ? 'error.entry_not_found' : 'error.generic')} />
}

function EntryView({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const cameFromApp = useLocation().key !== 'default'
  const queryClient = useQueryClient()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const entry = useQuery(entryQuery(id))
  const recordings = useQuery(entryRecordingsQuery(id)).data ?? []
  const [dialog, setDialog] = useState<'date' | 'delete' | null>(null)
  const [dateFailed, setDateFailed] = useState(false)
  const html = useMemo(() => renderMarkdown(entry.data?.bodyMd ?? ''), [entry.data?.bodyMd])

  if (!entry.data) return entry.isError ? <EntryError error={entry.error} /> : null
  const { entryDate } = entry.data

  const changeDate = async (day: string) => {
    setDialog(null)
    setDateFailed(false)
    try {
      queryClient.setQueryData(entryQuery(id).queryKey, await updateEntry(id, { entryDate: day }))
      await queryClient.invalidateQueries({ queryKey: ['timeline'] })
    } catch {
      setDateFailed(true)
    }
  }

  const remove = async () => {
    await deleteEntry(id)
    queryClient.removeQueries({ queryKey: entryQuery(id).queryKey })
    await queryClient.invalidateQueries({ queryKey: ['timeline'] })
    await navigate('/', { replace: true })
  }

  return (
    <>
      <div className="topbar entry-top">
        <Link
          to="/timeline"
          state={{ restoreScroll: true }}
          className="back"
          onClick={(event) => {
            if (!cameFromApp) return
            event.preventDefault()
            void navigate(-1)
          }}
        >
          <Icon name="back" />
          {t('common.back')}
        </Link>
        <div>
          <Link to={`/entries/${id}/edit`} className="icbtn" aria-label={t('entry.edit')}>
            <Icon name="pen" />
          </Link>
          <button
            type="button"
            className="icbtn del"
            aria-label={t('entry.delete')}
            onClick={() => {
              setDialog('delete')
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <h1 className="entry-date">{longDate(entryDate, i18n.language)}</h1>
      <button
        type="button"
        className="chip"
        onClick={() => {
          setDialog('date')
        }}
      >
        <Icon name="cal" />
        {t('entry.changeDate')}
      </button>
      {dateFailed ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t('error.generic')}</span>
        </div>
      ) : null}
      <div
        className="body-text md"
        data-testid="entry-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {recordings.length > 0 ? (
        <>
          <div className="lab">{t('entry.recordings')}</div>
          {recordings.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </>
      ) : null}
      <div className="addrow">
        <Link className="add" to={`/record?entry=${id}`}>
          <Icon name="mic" />
          {t('entry.recordAnother')}
        </Link>
        <Link className="add" to={`/upload?entry=${id}`}>
          <Icon name="upload" />
          {t('entry.uploadAnother')}
        </Link>
      </div>
      {dialog === 'date' ? (
        <DateDialog
          value={entryDate}
          today={todayIn(timeZone, new Date())}
          onCancel={() => {
            setDialog(null)
          }}
          onConfirm={(day) => void changeDate(day)}
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

export function EntryPage() {
  const { id = '' } = useParams()
  const sideBySide = useMediaQuery('(min-width: 1024px)')
  if (!sideBySide) return <EntryView id={id} />
  return (
    <div className="split">
      <TimelineList variant="row" currentId={id} />
      <article className="read">
        <div className="read-in">
          <EntryView id={id} />
        </div>
      </article>
    </div>
  )
}
