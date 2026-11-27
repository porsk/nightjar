import { todayIn } from '@nightjar/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { meQuery, timelineQuery } from '../api.ts'
import { dayHeading } from '../dates.ts'
import { rememberScroll, takeScroll } from '../timeline-scroll.ts'
import { EntryCard } from './entry-card.tsx'
import { Icon } from './icon.tsx'
import { ErrorNotice } from './error-notice.tsx'

interface TimelineListProps {
  /** `card` on its own screen, `row` beside the reading pane. */
  variant: 'card' | 'row'
  currentId?: string | undefined
  restoreScroll?: boolean
}

export function TimelineList({ variant, currentId, restoreScroll = false }: TimelineListProps) {
  const { t, i18n } = useTranslation()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const today = todayIn(timeZone, new Date())
  const timeline = useInfiniteQuery(timelineQuery)
  const { hasNextPage, isFetchingNextPage, isPending, fetchNextPage } = timeline
  const items = timeline.data?.pages.flatMap((page) => page.items) ?? []
  const end = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!restoreScroll || isPending) return
    const position = takeScroll()
    if (position > 0) window.scrollTo(0, position)
  }, [restoreScroll, isPending])

  useEffect(() => {
    const element = end.current
    if (!element || !hasNextPage || isFetchingNextPage) return undefined
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) void fetchNextPage()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, items.length, fetchNextPage])

  if (timeline.isError) return <ErrorNotice />

  return (
    <section className={variant === 'row' ? 'list' : 'timeline'} aria-label={t('timeline.title')}>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {item.entryDate !== items[index - 1]?.entryDate ? (
            <h2 className="day">{dayHeading(item.entryDate, today, i18n.language, t)}</h2>
          ) : null}
          <EntryCard
            item={item}
            variant={variant}
            current={item.id === currentId}
            {...(variant === 'card' ? { onOpen: rememberScroll } : {})}
          />
        </Fragment>
      ))}
      {!isPending && items.length === 0 ? (
        <div className="empty">
          <Icon name="list" />
          <p>{t('timeline.empty')}</p>
        </div>
      ) : null}
      {isPending || isFetchingNextPage ? (
        <>
          <div className="sk" aria-hidden="true" />
          <div className="sk short" aria-hidden="true" />
        </>
      ) : null}
      <p className="hint" role="status">
        {isFetchingNextPage ? t('timeline.loadingMore') : ''}
      </p>
      {hasNextPage ? <div ref={end} aria-hidden="true" /> : null}
    </section>
  )
}
