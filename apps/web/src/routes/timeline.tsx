import { useTranslation } from 'react-i18next'
import { NavigationType, useLocation, useNavigationType } from 'react-router'
import { TimelineList } from '../components/timeline-list.tsx'

export function TimelinePage() {
  const { t } = useTranslation()
  const navigationType = useNavigationType()
  const state = useLocation().state as { restoreScroll?: boolean } | null
  return (
    <>
      <h1 className="title">{t('timeline.title')}</h1>
      <TimelineList
        variant="card"
        restoreScroll={navigationType === NavigationType.Pop || state?.restoreScroll === true}
      />
    </>
  )
}
