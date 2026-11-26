import { todayIn } from '@nightjar/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, deleteEntry, entryQuery, meQuery, updateEntry } from '../api.ts'
import { DateDialog } from '../components/date-dialog.tsx'
import { DeleteDialog } from '../components/delete-dialog.tsx'
import { Icon } from '../components/icon.tsx'
import { longDate } from '../dates.ts'
import { renderMarkdown } from '../markdown.ts'

export function EntryError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const notFound = error instanceof ApiError && error.status === 404
  return <p role="alert">{t(notFound ? 'error.entry_not_found' : 'error.generic')}</p>
}

export function EntryPage() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const entry = useQuery(entryQuery(id))
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
    } catch {
      setDateFailed(true)
    }
  }

  const remove = async () => {
    await deleteEntry(id)
    queryClient.removeQueries({ queryKey: entryQuery(id).queryKey })
    await navigate('/timeline', { replace: true })
  }

  return (
    <>
      <div className="topbar entry-top">
        <Link to="/" className="back">
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
