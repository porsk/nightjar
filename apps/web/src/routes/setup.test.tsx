import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { apiError, json, me, renderApp, stubApi } from '../test-utils.tsx'

const needed = { 'GET /api/v1/setup': () => json({ needed: true }) }

async function fillAccount(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<Record<'code' | 'email' | 'password' | 'again', string>> = {},
) {
  const values = {
    code: 'ABCD2345',
    email: 'owner@example.test',
    password: 'correct horse',
    again: 'correct horse',
    ...overrides,
  }
  const fields: [string, string][] = [
    ['Setup code', values.code],
    ['Email', values.email],
    ['Password', values.password],
    ['Password again', values.again],
  ]
  for (const [label, text] of fields) {
    if (text) await user.type(screen.getByLabelText(label), text)
  }
}

describe('001-setup-login: setup wizard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['empty setup code', { code: '' }, 'Enter the setup code.'],
    ['invalid email', { email: 'a@b' }, 'Enter a valid email.'],
    [
      'password of 7 characters',
      { password: '1234567', again: '1234567' },
      'Use at least 8 characters.',
    ],
    ['different passwords', { again: 'something else' }, "The passwords don't match."],
  ])('AC-2: %s shows an error and stays on step 1', async (_name, overrides, message) => {
    stubApi(needed)
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user, overrides)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeInTheDocument()
  })

  it('AC-2: a password of exactly 8 characters is accepted', async () => {
    stubApi(needed)
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user, { password: '12345678', again: '12345678' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(
      await screen.findByRole('heading', { name: 'Language and time zone' }),
    ).toBeInTheDocument()
  })

  it('AC-3: starts in English in a Hungarian browser, then Magyar re-renders the wizard', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Budapest',
    } as Intl.ResolvedDateTimeFormatOptions)
    await i18n.changeLanguage('hu')
    stubApi(needed)
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Budapest')
    await user.click(screen.getByRole('radio', { name: 'Magyar' }))
    expect(screen.getByRole('heading', { name: 'Nyelv és időzóna' })).toBeInTheDocument()
    expect(screen.getByText('2. lépés a 3-ból')).toBeInTheDocument()
  })

  it('AC-4: finishing with "Not now" sends the choices and lands on Home', async () => {
    const calls = stubApi({
      ...needed,
      'POST /api/v1/setup': () => json(me, 201),
      'GET /api/v1/me': () => json(me),
    })
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(await screen.findByRole('heading', { name: /What's on your mind/ })).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/v1/setup')?.body).toMatchObject({
      setupCode: 'ABCD2345',
      email: 'owner@example.test',
      uiLanguage: 'en',
      transcriptionEnabled: false,
    })
  })

  it('AC-5: choosing transcription changes the button and sends the flag', async () => {
    const calls = stubApi({
      ...needed,
      'POST /api/v1/setup': () => json(me, 201),
      'GET /api/v1/me': () => json(me),
    })
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('radio', { name: /Turn on transcription/ }))
    await user.click(screen.getByRole('button', { name: 'Finish and start download' }))
    await screen.findByRole('heading', { name: /What's on your mind/ })
    expect(calls.find((call) => call.key === 'POST /api/v1/setup')?.body).toMatchObject({
      transcriptionEnabled: true,
    })
  })

  it('AC-17: a wrong setup code sends the wizard back to step 1 with the error by the field', async () => {
    stubApi({ ...needed, 'POST /api/v1/setup': () => apiError(403, 'invalid_setup_code') })
    const user = userEvent.setup()
    renderApp('/setup')
    await screen.findByRole('heading', { name: 'Welcome to Nightjar' })
    await fillAccount(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    const field = (await screen.findByLabelText('Setup code')).closest('.field') as HTMLElement
    expect(within(field).getByText('Wrong setup code.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeInTheDocument()
    })
  })

  it('AC-1: every path shows the wizard while no account exists', async () => {
    stubApi(needed)
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Welcome to Nightjar' })).toBeInTheDocument()
  })

  it('AC-6: /setup goes to the login screen once an account exists', async () => {
    stubApi({
      'GET /api/v1/setup': () => json({ needed: false }),
      'GET /api/v1/me': () => apiError(401, 'unauthorized'),
    })
    renderApp('/setup')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
  })
})
