import { fireEvent, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const hit = (overrides: object = {}) => ({
  entryId: 'e1',
  entryDate: '2026-11-26',
  createdAt: '2026-11-26T19:42:00.000Z',
  source: 'text',
  snippet: 'Went on the <mark>move</mark> today',
  ...overrides,
})

const found = (results: object[], total = results.length) => json({ total, results })

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

/** Lets timers run and the requests they start come back and show on screen. */
const pass = async (milliseconds: number) => {
  await vi.advanceTimersByTimeAsync(milliseconds)
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(0)
  }
}

const box = () => screen.getByRole('searchbox', { name: 'Search' })
const type = (value: string) => {
  fireEvent.change(box(), { target: { value } })
}

/** Renders the search screen and lets the sign-in checks finish. */
async function open() {
  const view = renderApp('/search')
  await pass(50)
  return view
}

const searchRoute = 'POST /api/v1/search'
const searchCalls = (calls: { key: string; body: unknown }[]) =>
  calls.filter((call) => call.key === searchRoute)

describe('005-search: search screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('AC-6: a card shows the date and time, the source and the snippet with the match highlighted', async () => {
    stubApi({
      ...signedIn,
      [searchRoute]: () =>
        found([
          hit(),
          hit({
            entryId: 'e2',
            source: 'transcript',
            createdAt: '2026-11-25T08:05:00.000Z',
            entryDate: '2026-11-25',
          }),
        ]),
    })
    await open()
    type('move')
    await pass(350)
    const cards = screen.getAllByRole('link')
    const result = cards.find((card) => card.getAttribute('href') === '/entries/e1') as HTMLElement
    expect(result).toHaveTextContent('Nov 26, 2026')
    expect(result).toHaveTextContent('8:42 PM')
    expect(within(result).getByText('text')).toBeInTheDocument()
    const mark = within(result).getByText('move')
    expect(mark.tagName).toBe('MARK')
    expect(result).toHaveTextContent('Went on the move today')
    const other = cards.find((card) => card.getAttribute('href') === '/entries/e2') as HTMLElement
    expect(within(other).getByText('transcript')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 results')
  })

  it('AC-6: the snippet is never read as HTML, only the marks are', async () => {
    stubApi({
      ...signedIn,
      [searchRoute]: () =>
        found([
          hit({
            snippet:
              'Before &lt;img src=x onerror=alert(1)&gt; the <mark>move</mark> &amp; &lt;mark&gt;after',
          }),
        ]),
    })
    const { container } = await open()
    type('move')
    await pass(350)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Before/ })).toHaveTextContent(
      'Before <img src=x onerror=alert(1)> the move & <mark>after',
    )
  })

  it('AC-6: the count is singular for one result', async () => {
    stubApi({ ...signedIn, [searchRoute]: () => found([hit()]) })
    await open()
    type('move')
    await pass(350)
    expect(screen.getByRole('status')).toHaveTextContent('1 result')
  })

  it('AC-6: everything on the screen is Hungarian for a Hungarian user', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/me': () => json({ ...me, uiLanguage: 'hu' }),
      [searchRoute]: () => found([hit({ source: 'transcript' }), hit({ entryId: 'e2' })]),
    })
    await open()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Keresés' }), {
      target: { value: 'move' },
    })
    await pass(350)
    expect(screen.getByRole('status')).toHaveTextContent('2 találat')
    expect(screen.getByText('átirat')).toBeInTheDocument()
    expect(screen.getByText('szöveg')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /2026\. nov\. 26\./ })).toHaveLength(2)
  })

  it('AC-6: shows the full count when there are more matches than cards', async () => {
    stubApi({ ...signedIn, [searchRoute]: () => found([hit()], 73) })
    await open()
    type('move')
    await pass(350)
    expect(screen.getByRole('status')).toHaveTextContent('73 results')
  })

  it('AC-7: no match shows the empty state with its hint', async () => {
    stubApi({ ...signedIn, [searchRoute]: () => found([]) })
    await open()
    type('zzz')
    await pass(350)
    const empty = screen.getByRole('status')
    expect(empty).toHaveTextContent('No results')
    expect(empty).toHaveTextContent("Try a shorter or different word. Accents don't matter.")
  })

  it('AC-7: an empty or one character query sends nothing and shows no results', async () => {
    const calls = stubApi(signedIn)
    await open()
    type('a')
    await pass(1000)
    expect(searchCalls(calls)).toHaveLength(0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    type('a ')
    await pass(1000)
    expect(searchCalls(calls)).toHaveLength(0)
    type('')
    await pass(1000)
    expect(searchCalls(calls)).toHaveLength(0)
  })

  it('AC-8: the request goes out 300 ms after the last keystroke, once, with the words in the body not the URL', async () => {
    const calls = stubApi({ ...signedIn, [searchRoute]: () => found([hit()]) })
    await open()
    type('mov')
    await pass(299)
    expect(searchCalls(calls)).toHaveLength(0)
    await pass(1)
    expect(searchCalls(calls)).toEqual([{ key: searchRoute, body: { q: 'mov' } }])
  })

  it('AC-8: typing on restarts the wait, and only the last text is searched', async () => {
    const calls = stubApi({ ...signedIn, [searchRoute]: () => found([hit()]) })
    await open()
    type('mo')
    await pass(200)
    type('move')
    await pass(200)
    expect(searchCalls(calls)).toHaveLength(0)
    await pass(100)
    expect(searchCalls(calls)).toEqual([{ key: searchRoute, body: { q: 'move' } }])
  })

  it('AC-8: the clear button empties the box and the results', async () => {
    stubApi({ ...signedIn, [searchRoute]: () => found([hit()]) })
    await open()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    type('move')
    await pass(350)
    expect(screen.getByRole('link', { name: /Went on/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(box()).toHaveValue('')
    expect(box()).toHaveFocus()
    expect(screen.queryByRole('link', { name: /Went on/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('AC-8: a card opens its entry', async () => {
    stubApi({
      ...signedIn,
      [searchRoute]: () => found([hit()]),
      'GET /api/v1/entries/e1': () =>
        json({
          id: 'e1',
          entryDate: '2026-11-26',
          bodyMd: 'The opened entry text',
          createdAt: '2026-11-26T19:42:00.000Z',
          updatedAt: '2026-11-26T19:42:00.000Z',
        }),
      'GET /api/v1/entries/e1/recordings': () => json([]),
    })
    await open()
    type('move')
    await pass(350)
    fireEvent.click(screen.getByRole('link', { name: /Went on/ }))
    await pass(50)
    expect(screen.getByText('The opened entry text')).toBeInTheDocument()
  })
})
