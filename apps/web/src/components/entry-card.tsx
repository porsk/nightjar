import type { Language, TimelineItem } from '@nightjar/shared'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { meQuery } from '../api.ts'
import { formatDuration, formatTime } from '../format.ts'
import { Icon } from './icon.tsx'

const badgeStyle = { working: '', off: ' mute', failed: ' err' } as const

interface EntryCardProps {
  item: TimelineItem
  variant: 'card' | 'row'
  current?: boolean
  onOpen?: () => void
}

export function EntryCard({ item, variant, current = false, onOpen }: EntryCardProps) {
  const { t, i18n } = useTranslation()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const time = formatTime(new Date(item.createdAt), i18n.language as Language, timeZone)
  const length = item.hasRecordings ? ` · ${formatDuration(item.totalDurationMs)}` : ''
  return (
    <Link
      to={`/entries/${item.id}`}
      className={variant}
      aria-current={current ? 'true' : undefined}
      onClick={onOpen}
    >
      <span className="meta">
        <Icon name={item.hasRecordings ? 'mic' : 'pen'} />
        <span className="visually-hidden">
          {t(item.hasRecordings ? 'a11y.icon.voice' : 'a11y.icon.text')}
        </span>
        <span>{`${time}${length}`}</span>
        {item.badge ? (
          <span className={`badge${badgeStyle[item.badge]}`}>
            {item.badge === 'working' ? <Icon name="bird" /> : null}
            {item.badge === 'failed' ? <Icon name="alert" /> : null}
            {t(`badge.${item.badge}`)}
          </span>
        ) : null}
      </span>
      <span className={item.excerpt ? 'ex' : 'ex none'}>{item.excerpt ?? t('entry.noText')}</span>
    </Link>
  )
}
