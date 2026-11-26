const offsetLabel = (timeZone: string, at: Date) => {
  const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((entry) => entry.type === 'timeZoneName')
  const offset = part?.value.replace('GMT', 'UTC') ?? 'UTC'
  return offset === 'UTC' ? 'UTC+00:00' : offset
}

/** All IANA zones the browser knows, plus the browser's own zone, labelled with today's UTC offset. */
export function timeZoneOptions(at = new Date()) {
  const zones = new Set(Intl.supportedValuesOf('timeZone'))
  zones.add(Intl.DateTimeFormat().resolvedOptions().timeZone)
  return [...zones]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => ({ value: zone, label: `${zone} (${offsetLabel(zone, at)})` }))
}
