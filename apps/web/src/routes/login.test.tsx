import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { apiError, json, me, renderApp, stubApi } from '../test-utils.tsx'

const accountExists = { 'GET /api/v1/setup': () => json({ needed: false }) }

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Username'), 'owner')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('001-setup-login: login', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-10: a wrong password shows the alert', async () => {
    stubApi({
      ...accountExists,
      'GET /api/v1/me': () => apiError(401, 'unauthorized'),
      'POST /api/v1/auth/sign-in/username': () => apiError(401, 'invalid_username_or_password'),
    })
    renderApp('/login')
    await submitLogin(userEvent.setup())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Wrong username or password. Check them and try again.')
  })

  it('AC-11: a 429 shows the too many attempts message', async () => {
    stubApi({
      ...accountExists,
      'GET /api/v1/me': () => apiError(401, 'unauthorized'),
      'POST /api/v1/auth/sign-in/username': () => apiError(429, 'too_many_attempts'),
    })
    renderApp('/login')
    await submitLogin(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a minute and try again.',
    )
  })

  it('AC-9: a correct login lands on Home', async () => {
    let signedIn = false
    stubApi({
      ...accountExists,
      'GET /api/v1/me': () => (signedIn ? json(me) : apiError(401, 'unauthorized')),
      'POST /api/v1/auth/sign-in/username': () => {
        signedIn = true
        return json({})
      },
    })
    renderApp('/login')
    await submitLogin(userEvent.setup())
    expect(await screen.findByRole('heading', { name: /What's on your mind/ })).toBeInTheDocument()
  })

  it('AC-13: without a session an app page shows login, and signing in returns to that page', async () => {
    let signedIn = false
    stubApi({
      ...accountExists,
      'GET /api/v1/me': () => (signedIn ? json(me) : apiError(401, 'unauthorized')),
      'POST /api/v1/auth/sign-in/username': () => {
        signedIn = true
        return json({})
      },
    })
    renderApp('/settings')
    await submitLogin(userEvent.setup())
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('AC-12: Sign out in Settings shows the login screen', async () => {
    let signedIn = true
    const calls = stubApi({
      ...accountExists,
      'GET /api/v1/me': () => (signedIn ? json(me) : apiError(401, 'unauthorized')),
      'POST /api/v1/auth/sign-out': () => {
        signedIn = false
        return json({ success: true })
      },
    })
    renderApp('/settings')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument()
    expect(calls.some((call) => call.key === 'POST /api/v1/auth/sign-out')).toBe(true)
  })

  it('AC-13: a signed-in user sees their own language', async () => {
    stubApi({
      ...accountExists,
      'GET /api/v1/me': () => json({ ...me, uiLanguage: 'hu' }),
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Mi járt a fejedben/ })).toBeInTheDocument()
  })
})
