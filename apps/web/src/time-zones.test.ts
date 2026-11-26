import { describe, expect, it } from 'vitest'
import { timeZoneOptions } from './time-zones.ts'

const labelOf = (at: string, zone: string) =>
  timeZoneOptions(new Date(at)).find(({ value }) => value === zone)?.label

describe('006-settings: time zone options', () => {
  it('AC-3: labels each IANA zone with its UTC offset at the given moment', () => {
    expect(labelOf('2026-01-15T12:00:00Z', 'Europe/Budapest')).toBe('Europe/Budapest (UTC+01:00)')
    expect(labelOf('2026-07-15T12:00:00Z', 'Europe/Budapest')).toBe('Europe/Budapest (UTC+02:00)')
    expect(labelOf('2026-01-15T12:00:00Z', 'America/New_York')).toBe('America/New_York (UTC-05:00)')
    expect(labelOf('2026-01-15T12:00:00Z', 'Australia/Adelaide')).toBe(
      'Australia/Adelaide (UTC+10:30)',
    )
  })

  it('AC-3: lists every zone the browser supports', () => {
    const values = new Set(timeZoneOptions().map(({ value }) => value))
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      expect(values.has(zone), zone).toBe(true)
    }
  })

  it('AC-3: includes the saved zone', () => {
    const options = timeZoneOptions(new Date(), 'UTC')
    expect(options.some(({ value }) => value === 'UTC')).toBe(true)
  })
})
