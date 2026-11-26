import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { FakeEventSource, FakeIntersectionObserver } from '../test-fakes.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const item = (overrides: object = {}) => ({
  id: 'e1',
  entryDate: '2026-11-26',
  createdAt: '2026-11-26T19:42:00.000Z',
  excerpt: 'A walk by the river',
  hasRecordings: false,
  totalDurationMs: 0,
  badge: null,
  ...overrides,
})

const page = (items: object[], nextCursor: string | null = null) => ({ items, nextCursor })

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const timelineUrl = 'GET /api/v1/entries?limit=30'

describe('004-timeline: timeline screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('AC-1: days and the entries inside them keep the order the server sent', async () => {
    stubApi({
      ...signedIn,
      [timelineUrl]: () =>
        json(
          page([
            item({ id: 'a', excerpt: 'late today', createdAt: '2026-11-26T19:42:00.000Z' }),
            item({ id: 'b', excerpt: 'early today', createdAt: '2026-11-26T08:00:00.000Z' }),
            item({ id: 'c', excerpt: 'yesterday', entryDate: '2026-11-25' }),
          ]),
        ),
    })
    renderApp('/timeline')
    await screen.findByText('late today')
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Today, November 26', 'Yesterday, November 25'])
    const cards = screen.getAllByRole('link', { name: /today|yesterday/ })
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('late today'),
      expect.stringContaining('early today'),
      expect.stringContaining('yesterday'),
    ])
  })

  it('AC-2: headings follow the language, with the year for other years', async () => {
    await i18n.changeLanguage('hu')
    stubApi({
      ...signedIn,
      'GET /api/v1/me': () => json({ ...me, uiLanguage: 'hu' }),
      [timelineUrl]: () =>
        json(
          page([
            item({ id: 'a' }),
            item({ id: 'b', entryDate: '2026-11-25' }),
            item({ id: 'c', entryDate: '2026-11-23' }),
            item({ id: 'd', entryDate: '2025-12-05' }),
          ]),
        ),
    })
    renderApp('/timeline')
    await screen.findByRole('heading', { name: 'Ma, november 26.' })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Ma, november 26.',
      'Tegnap, november 25.',
      'Hétfő, november 23.',
      'Péntek, 2025. december 5.',
    ])
  })

  it('AC-3: a voice card shows the microphone, the time in the user zone, the length and the excerpt', async () => {
    stubApi({
      ...signedIn,
      [timelineUrl]: () =>
        json(
          page([
            item({
              id: 'voice',
              createdAt: '2026-11-26T19:42:00.000Z',
              hasRecordings: true,
              totalDurationMs: 108_000,
            }),
            item({ id: 'text', createdAt: '2026-11-26T11:05:00.000Z', excerpt: 'Lunch with Anna' }),
            item({
              id: 'mute',
              createdAt: '2026-11-26T10:00:00.000Z',
              excerpt: null,
              hasRecordings: true,
              totalDurationMs: 5000,
            }),
          ]),
        ),
    })
    renderApp('/timeline')
    const voice = (await screen.findByText('A walk by the river')).closest('a')
    expect(voice).toHaveAttribute('href', '/entries/voice')
    expect(within(voice as HTMLElement).getByText('Voice entry')).toBeInTheDocument()
    expect(voice).toHaveTextContent('8:42 PM · 1:48')

    const text = screen.getByText('Lunch with Anna').closest('a') as HTMLElement
    expect(within(text).getByText('Text entry')).toBeInTheDocument()
    expect(within(text).queryByText(/·/)).not.toBeInTheDocument()

    const mute = screen.getByText('Recording, no text').closest('a') as HTMLElement
    expect(within(mute).getByText('Voice entry')).toBeInTheDocument()
    expect(within(mute).getByText(/0:05/)).toBeInTheDocument()
  })

  it('AC-4: each badge says what is going on with the transcription', async () => {
    stubApi({
      ...signedIn,
      [timelineUrl]: () =>
        json(
          page([
            item({ id: '1', hasRecordings: true, badge: 'working' }),
            item({ id: '2', hasRecordings: true, badge: 'off' }),
            item({ id: '3', hasRecordings: true, badge: 'failed' }),
            item({ id: '4', hasRecordings: true, badge: null }),
          ]),
        ),
    })
    renderApp('/timeline')
    await screen.findByText('Transcribing')
    expect(screen.getByText('Not transcribed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Voice entry/ })).toHaveLength(4)
  })

  it('AC-4: when a recording changes the badge updates without a reload', async () => {
    let finished = false
    stubApi({
      ...signedIn,
      [timelineUrl]: () =>
        json(
          page([
            finished
              ? item({ id: '1', hasRecordings: true, excerpt: 'Now it has words' })
              : item({ id: '1', hasRecordings: true, excerpt: null, badge: 'working' }),
          ]),
        ),
    })
    renderApp('/timeline')
    await screen.findByText('Transcribing')
    expect(FakeEventSource.instances[0]?.url).toBe('/api/v1/events')

    finished = true
    act(() => {
      FakeEventSource.instances[0]?.emit('recording.updated', {
        entryId: '1',
        recordingId: 'r1',
        status: 'done',
      })
    })
    expect(await screen.findByText('Now it has words')).toBeInTheDocument()
    expect(screen.queryByText('Transcribing')).not.toBeInTheDocument()
  })

  it('AC-5: reaching the end loads the next page with the loading text meanwhile', async () => {
    let release: () => void = () => undefined
    const calls = stubApi({
      ...signedIn,
      [timelineUrl]: () => json(page([item({ id: 'a', excerpt: 'first page' })], 'cursor-1')),
      'GET /api/v1/entries?limit=30&before=cursor-1': async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return json(page([item({ id: 'b', excerpt: 'second page', entryDate: '2026-11-20' })]))
      },
    })
    renderApp('/timeline')
    await screen.findByText('first page')
    expect(screen.queryByText('Loading more entries…')).not.toBeInTheDocument()

    act(() => {
      FakeIntersectionObserver.instances.at(-1)?.show()
    })
    expect(await screen.findByText('Loading more entries…')).toBeInTheDocument()
    expect(calls.map((call) => call.key)).toContain('GET /api/v1/entries?limit=30&before=cursor-1')

    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(await screen.findByText('second page')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Loading more entries…')).not.toBeInTheDocument()
    })
    expect(screen.getByText('first page')).toBeInTheDocument()
  })

  it('AC-6: with no entries it says so and points to the Today page', async () => {
    stubApi({ ...signedIn, [timelineUrl]: () => json(page([])) })
    renderApp('/timeline')
    expect(
      await screen.findByText('No entries yet. Record or write one on the Today page.'),
    ).toBeInTheDocument()
  })

  it('AC-7: a card opens the entry page, whose Back link returns to the timeline', async () => {
    stubApi({
      ...signedIn,
      [timelineUrl]: () => json(page([item({ id: 'e1' })])),
      'GET /api/v1/entries/e1': () =>
        json({
          id: 'e1',
          entryDate: '2026-11-26',
          bodyMd: 'full text',
          createdAt: '2026-11-26T19:42:00.000Z',
          updatedAt: '2026-11-26T19:42:00.000Z',
        }),
    })
    const user = userEvent.setup()
    renderApp('/timeline')
    await user.click(await screen.findByText('A walk by the river'))
    expect(await screen.findByTestId('entry-body')).toHaveTextContent('full text')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/timeline')
    await user.click(screen.getByRole('link', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Timeline', level: 1 })).toBeInTheDocument()
  })

  it.each(['/entries/e1', '/entries/e1/edit'])(
    'AC-7: deleting the entry from %s leaves the timeline without it',
    async (path) => {
      let deleted = false
      stubApi({
        ...signedIn,
        [timelineUrl]: () =>
          json(page(deleted ? [] : [item({ id: 'e1', excerpt: 'doomed entry' })])),
        'GET /api/v1/entries/e1': () =>
          json({
            id: 'e1',
            entryDate: '2026-11-26',
            bodyMd: 'doomed entry',
            createdAt: '2026-11-26T19:42:00.000Z',
            updatedAt: '2026-11-26T19:42:00.000Z',
          }),
        'DELETE /api/v1/entries/e1': () => {
          deleted = true
          return new Response(null, { status: 204 })
        },
      })
      const user = userEvent.setup()
      renderApp(path)
      const open = path.endsWith('/edit') ? 'Delete entry' : 'Delete'
      await user.click(await screen.findByRole('button', { name: open }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
      )
      expect(await screen.findByRole('heading', { name: 'Timeline', level: 1 })).toBeInTheDocument()
      expect(
        await screen.findByText('No entries yet. Record or write one on the Today page.'),
      ).toBeInTheDocument()
    },
  )

  it('AC-7: on a wide screen the entry opens beside the list with its card marked current', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    stubApi({
      ...signedIn,
      [timelineUrl]: () =>
        json(page([item({ id: 'e1', excerpt: 'one' }), item({ id: 'e2', excerpt: 'two' })])),
      'GET /api/v1/entries/e2': () =>
        json({
          id: 'e2',
          entryDate: '2026-11-26',
          bodyMd: 'the second entry',
          createdAt: '2026-11-26T19:42:00.000Z',
          updatedAt: '2026-11-26T19:42:00.000Z',
        }),
    })
    renderApp('/entries/e2')
    expect(await screen.findByTestId('entry-body')).toHaveTextContent('the second entry')
    const list = await screen.findByRole('region', { name: 'Timeline' })
    expect(within(list).getByText('two').closest('a')).toHaveAttribute('aria-current', 'true')
    expect(within(list).getByText('one').closest('a')).not.toHaveAttribute('aria-current')
  })

  it('AC-10: the time follows the user time zone and the day stays where the entry was filed', async () => {
    const late = item({
      id: 'late',
      entryDate: '2026-11-27',
      createdAt: '2026-11-26T23:30:00.000Z',
      excerpt: 'after midnight',
    })
    stubApi({
      ...signedIn,
      'GET /api/v1/me': () => json({ ...me, timeZone: 'Europe/Budapest' }),
      [timelineUrl]: () => json(page([late])),
    })
    const first = renderApp('/timeline')
    const card = (await screen.findByText('after midnight')).closest('a') as HTMLElement
    expect(card).toHaveTextContent('12:30 AM')
    expect(screen.getByRole('heading', { name: 'Friday, November 27' })).toBeInTheDocument()
    first.unmount()

    stubApi({
      ...signedIn,
      'GET /api/v1/me': () => json({ ...me, timeZone: 'UTC' }),
      [timelineUrl]: () => json(page([late])),
    })
    renderApp('/timeline')
    const utcCard = (await screen.findByText('after midnight')).closest('a') as HTMLElement
    expect(utcCard).toHaveTextContent('11:30 PM')
    expect(screen.getByRole('heading', { name: 'Friday, November 27' })).toBeInTheDocument()
  })
})
