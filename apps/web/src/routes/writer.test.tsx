import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { apiError, json, me, renderApp, stubApi } from '../test-utils.tsx'

const entry = (overrides: object = {}) => ({
  id: 'e1',
  entryDate: '2026-11-26',
  bodyMd: '',
  createdAt: '2026-11-26T20:30:00.000Z',
  updatedAt: '2026-11-26T20:30:00.000Z',
  ...overrides,
})

const signedIn = (language: 'en' | 'hu' = 'en') => ({
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json({ ...me, uiLanguage: language }),
})

const advance = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('002-text-entries: writer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const setup = () => userEvent.setup()

  it('AC-1: Home opens the writer titled "New entry" with the date chip for today', async () => {
    stubApi(signedIn())
    renderApp('/')
    await setup().click(await screen.findByRole('button', { name: "I'd rather write" }))
    expect(await screen.findByRole('heading', { name: 'New entry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today, November 26' })).toBeInTheDocument()
  })

  it('AC-1: in Hungarian the writer is "Új bejegyzés" with "Ma, november 26."', async () => {
    stubApi(signedIn('hu'))
    renderApp('/')
    await setup().click(await screen.findByRole('button', { name: 'Inkább írok' }))
    expect(await screen.findByRole('heading', { name: 'Új bejegyzés' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ma, november 26.' })).toBeInTheDocument()
  })

  it('AC-2: saves once, 1 second after the last keystroke, and shows the time it was saved', async () => {
    const calls = stubApi({
      ...signedIn(),
      'POST /api/v1/entries': () => json(entry({ bodyMd: 'hello world' }), 201),
    })
    renderApp('/write')
    const textarea = await screen.findByLabelText('Entry text')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:30:00Z'))
    const posts = () => calls.filter((call) => call.key === 'POST /api/v1/entries')
    const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
    fireEvent.change(textarea, { target: { value: 'hello' } })
    await wait(600)
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    await wait(999)
    expect(posts()).toHaveLength(0)
    await wait(1)
    expect(posts()).toHaveLength(1)
    expect(posts()[0]?.body).toEqual({ bodyMd: 'hello world', entryDate: '2026-11-26' })
    await wait(5000)
    expect(posts()).toHaveLength(1)
    await wait(0)
    expect(screen.getByText('Saved 21:30')).toBeInTheDocument()
  })

  it('AC-2: while the text is empty nothing is created', async () => {
    const calls = stubApi(signedIn())
    const user = setup()
    renderApp('/write')
    const textarea = await screen.findByLabelText('Entry text')
    await user.type(textarea, 'a')
    await user.clear(textarea)
    await advance(1500)
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)
  })

  it('AC-2: the next saves update the entry that the first save created', async () => {
    const calls = stubApi({
      ...signedIn(),
      'POST /api/v1/entries': () => json(entry({ bodyMd: 'one' }), 201),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'one' })),
      'PATCH /api/v1/entries/e1': () => json(entry({ bodyMd: 'one two' })),
    })
    const user = setup()
    renderApp('/write')
    await user.type(await screen.findByLabelText('Entry text'), 'one')
    await advance(1100)
    await screen.findByText('Saved 21:30')
    expect(screen.getByRole('heading', { name: 'New entry' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Entry text'), ' two')
    await advance(1100)
    expect(calls.filter((call) => call.key === 'PATCH /api/v1/entries/e1')).toHaveLength(1)
    expect(calls.find((call) => call.key === 'PATCH /api/v1/entries/e1')?.body).toEqual({
      bodyMd: 'one two',
    })
    expect(screen.getByLabelText('Entry text')).toHaveValue('one two')
  })

  it('AC-3: Done saves the unsaved text and opens the entry page with it', async () => {
    stubApi({
      ...signedIn(),
      'POST /api/v1/entries': () => json(entry({ bodyMd: 'quick note' }), 201),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'quick note' })),
    })
    const user = setup()
    renderApp('/write')
    await user.type(await screen.findByLabelText('Entry text'), 'quick note')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByTestId('entry-body')).toHaveTextContent('quick note')
    expect(screen.getByRole('button', { name: 'Change date' })).toBeInTheDocument()
  })

  it('AC-3: Done on an empty new entry goes home and creates nothing', async () => {
    const calls = stubApi(signedIn())
    renderApp('/write')
    await setup().click(await screen.findByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)
  })

  it('AC-5: a date picked on a new entry is used when it is first saved', async () => {
    const calls = stubApi({
      ...signedIn(),
      'POST /api/v1/entries': () => json(entry({ entryDate: '2026-11-20' }), 201),
      'GET /api/v1/entries/e1': () => json(entry({ entryDate: '2026-11-20' })),
    })
    const user = setup()
    renderApp('/write')
    await user.click(await screen.findByRole('button', { name: 'Today, November 26' }))
    await user.click(screen.getByRole('button', { name: '20' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Friday, November 20, 2026' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Entry text'), 'about friday')
    await advance(1100)
    expect(calls.find((call) => call.key === 'POST /api/v1/entries')?.body).toEqual({
      bodyMd: 'about friday',
      entryDate: '2026-11-20',
    })
  })

  it('AC-8: edit opens "Edit entry" with the current text and date, edits autosave', async () => {
    const calls = stubApi({
      ...signedIn(),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'old text', entryDate: '2026-11-20' })),
      'PATCH /api/v1/entries/e1': () =>
        json(entry({ bodyMd: 'old text!', entryDate: '2026-11-20' })),
    })
    const user = setup()
    renderApp('/entries/e1/edit')
    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeInTheDocument()
    expect(screen.getByLabelText('Entry text')).toHaveValue('old text')
    expect(screen.getByRole('button', { name: 'Friday, November 20, 2026' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Entry text'), '!')
    await advance(1100)
    expect(calls.find((call) => call.key === 'PATCH /api/v1/entries/e1')?.body).toEqual({
      bodyMd: 'old text!',
    })
    expect(await screen.findByText('Saved 21:30')).toBeInTheDocument()
  })

  it('AC-5: changing the date of an existing entry saves it', async () => {
    const calls = stubApi({
      ...signedIn(),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'text' })),
      'PATCH /api/v1/entries/e1': () => json(entry({ bodyMd: 'text', entryDate: '2026-11-20' })),
    })
    const user = setup()
    renderApp('/entries/e1/edit')
    await user.click(await screen.findByRole('button', { name: 'Today, November 26' }))
    await user.click(screen.getByRole('button', { name: '20' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('button', { name: 'Friday, November 20, 2026' })).toBeVisible()
    expect(calls.find((call) => call.key === 'PATCH /api/v1/entries/e1')?.body).toEqual({
      entryDate: '2026-11-20',
    })
  })

  it('AC-10: a failed save shows the message with a retry, keeps the text, and clears when it works', async () => {
    let fail = true
    stubApi({
      ...signedIn(),
      'POST /api/v1/entries': () =>
        fail ? apiError(500, 'internal_error') : json(entry({ bodyMd: 'precious' }), 201),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'precious' })),
    })
    const user = setup()
    renderApp('/write')
    await user.type(await screen.findByLabelText('Entry text'), 'precious')
    await advance(1100)
    expect(await screen.findByText("Couldn't save.")).toBeInTheDocument()
    expect(screen.getByLabelText('Entry text')).toHaveValue('precious')

    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Saved 21:30')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't save.")).not.toBeInTheDocument()
  })

  it('AC-10: a network error is a failed save too, and the next autosave can clear it', async () => {
    let fail = true
    const responses = {
      ...signedIn(),
      'POST /api/v1/entries': () => {
        if (fail) throw new TypeError('network down')
        return json(entry({ bodyMd: 'abc' }), 201)
      },
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'abc' })),
    }
    stubApi(responses)
    const user = setup()
    renderApp('/write')
    await user.type(await screen.findByLabelText('Entry text'), 'ab')
    await advance(1100)
    expect(await screen.findByText("Couldn't save.")).toBeInTheDocument()
    fail = false
    await user.type(screen.getByLabelText('Entry text'), 'c')
    await advance(1100)
    expect(await screen.findByText('Saved 21:30')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't save.")).not.toBeInTheDocument()
  })

  it('AC-9: Cancel in the delete dialog of the edit screen keeps the entry', async () => {
    const calls = stubApi({
      ...signedIn(),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'keep me' })),
    })
    const user = setup()
    renderApp('/entries/e1/edit')
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete this entry?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)
    expect(screen.getByLabelText('Entry text')).toHaveValue('keep me')
  })

  it('AC-9: confirming the delete dialog of the edit screen deletes the entry', async () => {
    const calls = stubApi({
      ...signedIn(),
      'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'bye' })),
      'DELETE /api/v1/entries/e1': () => new Response(null, { status: 204 }),
    })
    const user = setup()
    renderApp('/entries/e1/edit')
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(calls.some((call) => call.key === 'DELETE /api/v1/entries/e1')).toBe(true)
    expect(screen.queryByLabelText('Entry text')).not.toBeInTheDocument()
  })
})
