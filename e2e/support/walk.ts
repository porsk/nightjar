import { expect, type Page } from '@playwright/test'
import { en } from '../../apps/web/src/i18n/en.ts'
import { hu } from '../../apps/web/src/i18n/hu.ts'
import { adminEmail, createAdmin, password, resetDatabase } from './server.ts'

export type Language = 'en' | 'hu'
export const catalogue = { en, hu }

/**
 * Opens every M1 screen state that exists so far, in the given language, and calls `check` on each.
 * The browser locale must already be the language, as login follows it.
 */
export async function walkScreens(
  page: Page,
  language: Language,
  headers: Record<string, string>,
  check: (state: string) => Promise<void>,
) {
  const t = catalogue[language]
  const label = (text: string) => page.getByLabel(text, { exact: true })

  await resetDatabase()
  await page.goto('/setup')
  await label(en.setup.account.code).fill('WRONG123')
  await label(en.field.email).fill(adminEmail)
  await label(en.field.password).fill(password)
  await label(en.setup.account.passwordAgain).fill(password)
  if (language === 'hu') {
    await page.getByRole('button', { name: en.common.next }).click()
    await page.getByRole('radio', { name: 'Magyar' }).check({ force: true })
    await expect(page.getByRole('heading', { name: hu.setup.lang.title })).toBeVisible()
    await page.getByRole('button', { name: hu.common.back }).click()
  }
  await expect(page.getByRole('heading', { name: t.setup.account.title })).toBeVisible()
  await check('setup step 1')

  await label(t.setup.account.passwordAgain).fill('different')
  await page.getByRole('button', { name: t.common.next }).click()
  await expect(page.getByText(t.field.error.passwordMismatch)).toBeVisible()
  await check('setup step 1 with errors')
  await label(t.setup.account.passwordAgain).fill(password)
  await page.getByRole('button', { name: t.common.next }).click()

  await expect(page.getByRole('heading', { name: t.setup.lang.title })).toBeVisible()
  await check('setup step 2')
  await page.getByRole('button', { name: t.common.next }).click()
  await expect(page.getByRole('heading', { name: t.setup.transcription.title })).toBeVisible()
  await check('setup step 3')
  await page.getByRole('radio', { name: t.setup.transcription.on }).check({ force: true })
  await check('setup step 3 with transcription on')

  await resetDatabase()
  await createAdmin(headers, language)
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: t.login.title })).toBeVisible()
  await check('login')
  await label(t.field.email).fill(adminEmail)
  await label(t.field.password).fill('not the password')
  await page.getByRole('button', { name: t.login.submit }).click()
  await expect(page.getByRole('alert')).toHaveText(t.login.error.invalid)
  await check('login with wrong password')
  await label(t.field.password).fill(password)
  await page.getByRole('button', { name: t.login.submit }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await check('home')
  await page.getByRole('link', { name: t.nav.settings }).first().click()
  await expect(page.getByRole('heading', { name: t.settings.title })).toBeVisible()
  await check('settings')

  await page.route('**/api/v1/me/settings', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'internal_error', message: 'x' } } }),
  )
  await page
    .getByRole('radiogroup', { name: t.settings.entryLanguage })
    .getByRole('radio', { name: t.settings.auto })
    .click({ force: true })
  await expect(page.getByRole('alert')).toHaveText(t.settings.saveFailed)
  await check('settings with save error')
  await page.unroute('**/api/v1/me/settings')

  await page.goto('/nowhere')
  await expect(page.getByText(t.error.notFound)).toBeVisible()
  await check('not found')
}
