import { expect, test, type Page } from '@playwright/test'
import {
  adminEmail,
  createAdmin,
  password,
  readTranscriptionFlag,
  resetDatabase,
  setupCodeFromLog,
  uniqueIp,
} from './support/server.ts'

let headers: Record<string, string>

test.beforeEach(async ({ context }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
})

async function fillAccount(page: Page, code = setupCodeFromLog()) {
  await page.getByLabel('Setup code').fill(code)
  await page.getByLabel('Email', { exact: true }).fill(adminEmail)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password again').fill(password)
  await page.getByRole('button', { name: 'Next' }).click()
}

async function login(page: Page, pass = password) {
  await page.getByLabel('Email').fill(adminEmail)
  await page.getByLabel('Password').fill(pass)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('001-setup-login: setup wizard and login', () => {
  test('AC-1: every app URL shows setup step 1 on an empty install', async ({ page }) => {
    for (const path of ['/', '/timeline', '/login']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeVisible()
      await expect(page).toHaveURL(/\/setup$/)
    }
  })

  test('AC-4: the wizard in English ends on Home, signed in', async ({ page }) => {
    await page.goto('/')
    await fillAccount(page)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
    expect(await readTranscriptionFlag()).toBe(false)
  })

  test('AC-4: the wizard in Hungarian ends on Home in Hungarian', async ({ page }) => {
    await page.goto('/setup')
    await fillAccount(page)
    await page.getByRole('radio', { name: 'Magyar' }).check({ force: true })
    await expect(page.getByRole('heading', { name: 'Nyelv és időzóna' })).toBeVisible()
    await page.getByRole('button', { name: 'Tovább' }).click()
    await page.getByRole('button', { name: 'Befejezés', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Mi járt a fejedben/ })).toBeVisible()
  })

  test('AC-5: choosing transcription finishes setup and stores the flag', async ({ page }) => {
    await page.goto('/setup')
    await fillAccount(page)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('radio', { name: /Turn on transcription/ }).check({ force: true })
    await page.getByRole('button', { name: 'Finish and start download' }).click()
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
    expect(await readTranscriptionFlag()).toBe(true)
  })

  test('AC-17: a wrong setup code shows the error on step 1, the right one works', async ({
    page,
  }) => {
    await page.goto('/setup')
    await fillAccount(page, 'WRONG123')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(page.getByText('Wrong setup code.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeVisible()
    await page.getByLabel('Setup code').fill(setupCodeFromLog())
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Finish', exact: true }).click()
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
  })

  test('AC-6: /setup shows the login screen once an account exists', async ({ page }) => {
    await createAdmin(headers)
    await page.goto('/setup')
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('AC-9: signing in lands on Home', async ({ page }) => {
    await createAdmin(headers)
    await page.goto('/login')
    await login(page)
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
  })

  test('AC-10: a wrong password shows the alert', async ({ page }) => {
    await createAdmin(headers)
    await page.goto('/login')
    await login(page, 'not the password')
    await expect(page.getByRole('alert')).toHaveText(
      'Wrong email or password. Check them and try again.',
    )
  })

  test('AC-11: after 10 failed logins the screen asks to wait', async ({ page, request }) => {
    await createAdmin(headers)
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await request.post('/api/v1/auth/sign-in/email', {
        headers,
        data: { email: adminEmail, password: 'wrong password' },
      })
      expect(response.status()).toBe(401)
    }
    await page.goto('/login')
    await login(page)
    await expect(page.getByRole('alert')).toHaveText(
      'Too many attempts. Wait a minute and try again.',
    )
  })

  test('AC-12: signing out shows login and the old session stops working', async ({
    page,
    request,
    context,
  }) => {
    await createAdmin(headers)
    await page.goto('/login')
    await login(page)
    await expect(page.getByRole('heading', { name: /What's on your mind/ })).toBeVisible()
    await page.goto('/settings')
    const cookie = (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join('; ')
    expect((await request.get('/api/v1/me', { headers: { ...headers, cookie } })).status()).toBe(
      200,
    )

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    expect((await request.get('/api/v1/me', { headers: { ...headers, cookie } })).status()).toBe(
      401,
    )
  })

  test('AC-13: a deep link asks for login and returns to that page afterwards', async ({
    page,
    request,
  }) => {
    await createAdmin(headers)
    expect((await request.get('/api/v1/me', { headers })).status()).toBe(401)
    await page.goto('/timeline')
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    await login(page)
    await expect(page).toHaveURL(/\/timeline$/)
  })
})

test.describe('001-setup-login: page load', () => {
  test('a page served with the strict Content-Security-Policy logs no policy violation', async ({
    page,
  }) => {
    await createAdmin(headers)
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy|script-src/.test(message.text())) violations.push(message.text())
    })
    await page.goto(`http://localhost:${process.env['NIGHTJAR_E2E_SERVER_PORT'] ?? ''}/login`)
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    await page.waitForTimeout(500)
    expect(violations).toEqual([])
  })
})

test.describe('001-setup-login: wizard language follows no browser setting', () => {
  for (const locale of ['en-US', 'hu-HU']) {
    test.describe(`browser locale ${locale}`, () => {
      test.use({ locale, timezoneId: 'Europe/Budapest' })

      test('AC-3: the wizard starts in English with English and the browser time zone selected', async ({
        page,
      }) => {
        await page.goto('/setup')
        await expect(page.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeVisible()
        await fillAccount(page)
        await expect(page.getByRole('radio', { name: 'English' })).toBeChecked()
        await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Budapest')
        await page.getByRole('radio', { name: 'Magyar' }).check({ force: true })
        await expect(page.getByRole('heading', { name: 'Nyelv és időzóna' })).toBeVisible()
      })
    })
  }

  test.describe('Hungarian browser', () => {
    test.use({ locale: 'hu-HU' })

    test('AC-13: the login screen follows the browser language', async ({ page }) => {
      await createAdmin(headers)
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: 'Üdv újra.' })).toBeVisible()
    })
  })
})
