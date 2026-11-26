import { todayIn } from '@nightjar/shared'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { meQuery } from '../api.ts'
import { monthAndDay, weekdayName } from '../dates.ts'

/** Today's weekday, or with `full` the weekday and the date, in the user's time zone. */
export function TodayDate({ full = false }: { full?: boolean }) {
  const { i18n } = useTranslation()
  const timeZone = useQuery(meQuery).data?.timeZone ?? 'UTC'
  const today = todayIn(timeZone, new Date())
  const weekday = weekdayName(today, i18n.language)
  return (
    <span className={full ? 'date date-full' : 'date date-short'}>
      {full ? `${weekday}, ${monthAndDay(today, today, i18n.language)}` : weekday}
    </span>
  )
}
