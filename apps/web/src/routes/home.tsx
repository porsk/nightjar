import { todayIn } from '@nightjar/shared'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { dayEntriesQuery, meQuery } from '../api.ts'
import { EntryCard } from '../components/entry-card.tsx'
import { Icon } from '../components/icon.tsx'
import { TodayDate } from '../components/today-date.tsx'
import { greetingPeriod, hourIn } from '../format.ts'

export function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const now = new Date()
  const today = todayIn(timeZone, now)
  const entriesToday = useQuery(dayEntriesQuery(today))
  const items = entriesToday.data?.items ?? []

  return (
    <div className="home">
      <section className="hero">
        <TodayDate full />
        <h1 className="greet">{t(`home.greeting.${greetingPeriod(hourIn(now, timeZone))}`)}</h1>
        <div className="rec-wrap">
          <Link to="/record" className="rec" aria-label={t('home.record')}>
            <Icon name="mic" />
          </Link>
          <div className="rec-label">{t('home.record')}</div>
        </div>
        <div className="two">
          <button
            type="button"
            className="write"
            onClick={() => {
              void navigate('/write')
            }}
          >
            <Icon name="pen" />
            {t('home.write')}
          </button>
          <Link to="/upload" className="btn text upl">
            <Icon name="upload" />
            {t('home.upload')}
          </Link>
        </div>
      </section>
      <section className="today" aria-label={t('home.todayEntries')}>
        <h2 className="sec">{t('home.todayEntries')}</h2>
        {items.map((item) => (
          <EntryCard key={item.id} item={item} variant="card" />
        ))}
        {entriesToday.isSuccess && items.length === 0 ? (
          <p className="hint">{t('home.todayEmpty')}</p>
        ) : null}
      </section>
    </div>
  )
}
