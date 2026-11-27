import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { apiError, json, me, renderApp, stubApi } from '../test-utils.tsx'

const base = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const uiLanguage = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'App language' })).getByRole('radio', { name })

const patchBody = (calls: { key: string; body: unknown }[]) =>
  calls.find(({ key }) => key.startsWith('PATCH'))?.body

describe('006-settings: Settings screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-1: switching the app language re-renders the UI and <html lang> without a reload', async () => {
    const calls = stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => json({ ...me, uiLanguage: 'hu' }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByRole('heading', { name: 'Settings' })

    await user.click(uiLanguage('Magyar'))

    expect(await screen.findByRole('heading', { name: 'Beállítások' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('hu')
    expect(patchBody(calls)).toEqual({ uiLanguage: 'hu' })
  })

  it('AC-2: picking the default recording language saves it', async () => {
    const calls = stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => json({ ...me, entryLanguage: 'auto' }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const group = await screen.findByRole('radiogroup', { name: 'Default language for recordings' })
    expect(group).toBeInTheDocument()
    expect(screen.getByText('You can change it per entry.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Automatic' }))

    await waitFor(() => {
      expect(patchBody(calls)).toEqual({ entryLanguage: 'auto' })
    })
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked()
  })

  it('AC-3: the time zone select lists zones with their UTC offset and saves the pick', async () => {
    const calls = stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => json({ ...me, timeZone: 'Asia/Tokyo' }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const select = await screen.findByRole('combobox', { name: 'Time zone' })
    expect(select).toHaveValue('Europe/Budapest')
    expect(
      screen.getByRole('option', { name: /^Europe\/Budapest \(UTC\+0[12]:00\)$/ }),
    ).toBeInTheDocument()

    await user.selectOptions(select, 'Asia/Tokyo')

    await waitFor(() => {
      expect(patchBody(calls)).toEqual({ timeZone: 'Asia/Tokyo' })
    })
  })

  it('AC-4: a failed save puts the saved value back and shows an error', async () => {
    stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => apiError(500, 'internal_error'),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByRole('heading', { name: 'Settings' })

    await user.click(uiLanguage('Magyar'))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the setting.")
    expect(uiLanguage('English')).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('AC-4: an unknown time zone answer shows its own message and keeps the saved zone', async () => {
    stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => apiError(400, 'invalid_time_zone'),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const select = await screen.findByRole('combobox', { name: 'Time zone' })

    await user.selectOptions(select, 'Asia/Tokyo')

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown time zone.')
    expect(select).toHaveValue('Europe/Budapest')
  })

  it('AC-12: the account section shows the signed-in username and the sign out button', async () => {
    stubApi(base)
    renderApp('/settings')
    expect(await screen.findByText('owner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('AC-16: leaving the name field saves the new name', async () => {
    const calls = stubApi({
      ...base,
      'PATCH /api/v1/me/settings': () => json({ ...me, name: 'Árpád' }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const field = await screen.findByLabelText('What should we call you?')
    expect(field).toHaveValue('Örs')

    await user.clear(field)
    await user.type(field, 'Árpád')
    await user.tab()

    await waitFor(() => {
      expect(patchBody(calls)).toEqual({ name: 'Árpád' })
    })
    expect(screen.getByLabelText('What should we call you?')).toHaveValue('Árpád')
  })

  it('AC-16: an empty name shows an error and sends nothing', async () => {
    const calls = stubApi(base)
    const user = userEvent.setup()
    renderApp('/settings')
    const field = await screen.findByLabelText('What should we call you?')

    await user.clear(field)
    await user.tab()

    expect(await screen.findByText('Enter your name (60 characters at most).')).toBeInTheDocument()
    expect(patchBody(calls)).toBeUndefined()
  })

  it('AC-16: an unchanged name sends nothing', async () => {
    const calls = stubApi(base)
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByLabelText('What should we call you?')
    await user.click(screen.getByLabelText('What should we call you?'))
    await user.tab()
    expect(patchBody(calls)).toBeUndefined()
  })

  it('AC-16: a failed save puts the saved name back and shows an error', async () => {
    stubApi({ ...base, 'PATCH /api/v1/me/settings': () => apiError(500, 'internal') })
    const user = userEvent.setup()
    renderApp('/settings')
    const field = await screen.findByLabelText('What should we call you?')

    await user.clear(field)
    await user.type(field, 'Árpád')
    await user.tab()

    expect(await screen.findByText("Couldn't save the setting.")).toBeInTheDocument()
    expect(field).toHaveValue('Örs')
  })
})
