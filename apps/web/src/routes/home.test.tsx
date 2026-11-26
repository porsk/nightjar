import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const today = (items: object[] = []) => json({ items, nextCursor: null })

const card = (overrides: object = {}) => ({
  id: 'e1',
  entryDate: '2026-11-26',
  createdAt: '2026-11-26T19:42:00.000Z',
  excerpt: 'Dinner with Anna',
  hasRecordings: false,
  totalDurationMs: 0,
  badge: null,
  ...overrides,
})

const signedIn = (user: object = me) => ({
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(user),
})

describe('004-timeline: Home', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const openHomeAt = async (moment: string, user: object = me, entries: object[] = []) => {
    vi.setSystemTime(new Date(moment))
    const calls = stubApi({
      ...signedIn(user),
      'GET /api/v1/entries?date=2026-11-26': () => today(entries),
      'GET /api/v1/entries?date=2026-11-27': () => today(),
    })
    renderApp('/')
    await screen.findByRole('heading', { level: 1 })
    return calls
  }

  const greeting = () => screen.getByRole('heading', { level: 1 }).textContent

  it('AC-8: the greeting follows the hour in the user time zone', async () => {
    await openHomeAt('2026-11-26T20:00:00Z')
    expect(greeting()).toBe("Good evening. What's on your mind?")
  })

  it('AC-8: 5 to 10 is morning, 10 to 18 afternoon and the rest evening', async () => {
    await openHomeAt('2026-11-26T04:00:00Z')
    expect(greeting()).toBe("Good morning. What's on your mind?")
  })

  it('AC-8: the same moment gives another greeting in another time zone', async () => {
    await openHomeAt('2026-11-26T08:30:00Z', { ...me, timeZone: 'UTC' })
    expect(greeting()).toBe("Good morning. What's on your mind?")
  })

  it('AC-8: after ten it is afternoon', async () => {
    await openHomeAt('2026-11-26T09:00:00Z')
    expect(greeting()).toBe("Good afternoon. What's on your mind?")
  })

  it('AC-8: Hungarian greeting and weekday', async () => {
    await i18n.changeLanguage('hu')
    await openHomeAt('2026-11-26T20:00:00Z', { ...me, uiLanguage: 'hu' })
    expect(greeting()).toBe('Jó estét. Mi járt a fejedben?')
    expect(screen.getByText('csütörtök')).toBeInTheDocument()
    expect(screen.getByText('csütörtök, november 26.')).toBeInTheDocument()
  })

  it('AC-8: shows the weekday, the date, the buttons and the entries of today', async () => {
    const calls = await openHomeAt('2026-11-26T20:00:00Z', me, [
      card(),
      card({ id: 'e2', excerpt: 'Morning run', createdAt: '2026-11-26T07:00:00.000Z' }),
    ])
    expect(screen.getByText('Thursday')).toBeInTheDocument()
    expect(screen.getByText('Thursday, November 26')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start recording' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "I'd rather write" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload an audio file' })).toBeInTheDocument()

    const section = screen.getByRole('region', { name: "Today's entries" })
    expect(await within(section).findByText('Dinner with Anna')).toBeInTheDocument()
    const texts = within(section)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(texts[0]).toContain('Dinner with Anna')
    expect(texts[1]).toContain('Morning run')
    expect(calls.map((call) => call.key)).toContain('GET /api/v1/entries?date=2026-11-26')
  })

  it('AC-8: around midnight "today" is the day in the user time zone', async () => {
    const calls = await openHomeAt('2026-11-26T23:30:00Z')
    expect(calls.map((call) => call.key)).toContain('GET /api/v1/entries?date=2026-11-27')
    expect(calls.map((call) => call.key)).not.toContain('GET /api/v1/entries?date=2026-11-26')
  })

  it('AC-6: with nothing written today the list says so', async () => {
    await openHomeAt('2026-11-26T20:00:00Z')
    expect(await screen.findByText('No entries today yet.')).toBeInTheDocument()
  })
})
