import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { apiError, json, me, renderApp, stubApi } from '../test-utils.tsx'

const entry = (overrides: object = {}) => ({
  id: 'e1',
  entryDate: '2026-11-25',
  bodyMd: 'plain text',
  createdAt: '2026-11-25T20:30:00.000Z',
  updatedAt: '2026-11-25T20:30:00.000Z',
  ...overrides,
})

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

describe('002-text-entries: entry page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('AC-4: shows the date heading and the rendered Markdown', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1': () =>
        json(entry({ bodyMd: '**bold**\n\n- one\n- two\n\n[site](https://example.test)' })),
    })
    renderApp('/entries/e1')
    expect(
      await screen.findByRole('heading', { name: 'Wednesday, November 25, 2026' }),
    ).toBeInTheDocument()
    const body = screen.getByTestId('entry-body')
    expect(within(body).getByText('bold').tagName).toBe('STRONG')
    expect(within(body).getAllByRole('listitem')).toHaveLength(2)
    const link = within(body).getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('AC-4: raw HTML in the body is text and never becomes elements', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1': () =>
        json(
          entry({ bodyMd: '<script>window.pwned = 1</script>\n\n<img src=x onerror=alert(1)>' }),
        ),
    })
    renderApp('/entries/e1')
    const body = await screen.findByTestId('entry-body')
    expect(body.querySelector('script, img')).toBeNull()
    expect(body).toHaveTextContent('<script>window.pwned = 1</script>')
    expect(body).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect('pwned' in window).toBe(false)
  })

  it('AC-5: Change date, pick a day, Done saves it and the heading moves', async () => {
    const calls = stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1': () => json(entry()),
      'PATCH /api/v1/entries/e1': () => json(entry({ entryDate: '2026-11-20' })),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Change date' }))
    await user.click(screen.getByRole('button', { name: '20' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(
      await screen.findByRole('heading', { name: 'Friday, November 20, 2026' }),
    ).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'PATCH /api/v1/entries/e1')?.body).toEqual({
      entryDate: '2026-11-20',
    })
  })

  it('AC-5: Cancel in the date dialog changes nothing', async () => {
    const calls = stubApi({ ...signedIn, 'GET /api/v1/entries/e1': () => json(entry()) })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Change date' }))
    await user.click(screen.getByRole('button', { name: '20' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Wednesday, November 25, 2026' })).toBeVisible()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })

  it('AC-8: the edit button opens the writer for this entry', async () => {
    stubApi({ ...signedIn, 'GET /api/v1/entries/e1': () => json(entry({ bodyMd: 'to edit' })) })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('link', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeInTheDocument()
    expect(screen.getByLabelText('Entry text')).toHaveValue('to edit')
  })

  it('AC-9: Cancel in the delete dialog keeps the entry', async () => {
    const calls = stubApi({ ...signedIn, 'GET /api/v1/entries/e1': () => json(entry()) })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete this entry?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)
    expect(screen.getByTestId('entry-body')).toHaveTextContent('plain text')
  })

  it('AC-9: confirming deletes the entry and leaves the page', async () => {
    const calls = stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1': () => json(entry()),
      'DELETE /api/v1/entries/e1': () => new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    )
    expect(calls.some((call) => call.key === 'DELETE /api/v1/entries/e1')).toBe(true)
    await vi.waitFor(() => {
      expect(screen.queryByTestId('entry-body')).not.toBeInTheDocument()
    })
  })

  it('AC-11: an entry that is not there shows "Entry not found."', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1': () => apiError(404, 'entry_not_found'),
    })
    renderApp('/entries/e1')
    expect(await screen.findByText('Entry not found.')).toBeInTheDocument()
  })
})
