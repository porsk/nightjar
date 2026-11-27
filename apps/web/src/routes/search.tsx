import type { Language } from '@nightjar/shared'
import { searchDebounceMs, searchMinLength, type SearchResult } from '@nightjar/shared/search'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { meQuery, searchQuery } from '../api.ts'
import { ErrorNotice } from '../components/error-notice.tsx'
import { Icon } from '../components/icon.tsx'
import { Snippet } from '../components/snippet.tsx'
import { shortDate } from '../dates.ts'
import { formatTime } from '../format.ts'

function ResultCard({ result }: { result: SearchResult }) {
  const { t, i18n } = useTranslation()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const date = shortDate(result.entryDate, i18n.language)
  const time = formatTime(new Date(result.createdAt), i18n.language as Language, timeZone)
  return (
    <Link to={`/entries/${result.entryId}`} className="card hit">
      <span className="meta">
        <Icon name={result.source === 'transcript' ? 'mic' : 'pen'} />
        <span className="visually-hidden">
          {t(result.source === 'transcript' ? 'a11y.icon.voice' : 'a11y.icon.text')}
        </span>
        <span>{`${date}, ${time}`}</span>
        <span className="src">{t(`search.source.${result.source}`)}</span>
      </span>
      <span className="ex">
        <Snippet html={result.snippet} />
      </span>
    </Link>
  )
}

export function SearchPage() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [terms, setTerms] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const trimmed = text.trim()
  const searchable = trimmed.length >= searchMinLength

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerms(searchable ? trimmed : '')
    }, searchDebounceMs)
    return () => {
      clearTimeout(timer)
    }
  }, [trimmed, searchable])

  const results = useQuery({ ...searchQuery(terms), enabled: terms !== '' })
  const showing = searchable && terms !== ''

  const clear = () => {
    setText('')
    setTerms('')
    input.current?.focus()
  }

  return (
    <>
      <h1 className="title">{t('search.title')}</h1>
      <div className="sbox">
        <div className="inp">
          <Icon name="search" />
          <input
            ref={input}
            type="search"
            aria-label={t('search.label')}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
          {text ? (
            <button type="button" className="x" aria-label={t('search.clear')} onClick={clear}>
              <Icon name="x" />
            </button>
          ) : null}
        </div>
      </div>
      {showing && results.isError ? <ErrorNotice /> : null}
      {showing && results.data ? (
        results.data.results.length > 0 ? (
          <>
            <p className="count" role="status">
              {t('search.count', { count: results.data.total })}
            </p>
            {results.data.results.map((result) => (
              <ResultCard key={result.entryId} result={result} />
            ))}
          </>
        ) : (
          <div className="empty" role="status">
            <Icon name="search" />
            <h2>{t('search.empty.title')}</h2>
            <p>{t('search.empty.hint')}</p>
          </div>
        )
      ) : null}
    </>
  )
}
