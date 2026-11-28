const offsetMs = (timeZone: string, at: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** The instant this month began in the time zone: midnight of the 1st. */
export function monthStart(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const local = Date.UTC(year, month - 1, 1)
  const first = local - offsetMs(timeZone, new Date(local))
  return new Date(local - offsetMs(timeZone, new Date(first)))
}

/** Hours of audio times the list price, rounded to cents. */
export const estimatedCost = (audioMs: number, pricePerHour: number) =>
  Math.round((audioMs / 3_600_000) * pricePerHour * 100) / 100
