import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import { adminEmail, createAdmin, password, resetDatabase, uniqueIp } from './support/server.ts'

const viewports = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

async function checkScreen(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, name).toEqual([])
  await expectLayout(page, name)
  const file = `${name}.png`
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: true })
  await testInfo.attach(name, { path: testInfo.outputPath(file), contentType: 'image/png' })
}

test.describe('001-setup-login: screens are accessible and look right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots',
  )

  for (const locale of ['en-US', 'hu-HU']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        test.describe(`${locale} ${colorScheme} ${String(width)}`, () => {
          test.use({ locale, colorScheme, viewport: viewports[width] })

          test(`AC-15: axe finds nothing on the setup steps (${locale} ${colorScheme} ${String(width)})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            await context.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
            const tag = `${colorScheme}-${String(width)}-${locale.slice(0, 2)}`
            await page.goto('/setup')
            await expect(page.getByRole('heading', { name: 'Welcome to Nightjar' })).toBeVisible()
            await page.getByLabel('Setup code').fill('ABCD2345')
            await page.getByLabel('Email', { exact: true }).fill(adminEmail)
            await page.getByLabel('Password', { exact: true }).fill(password)
            await page.getByLabel('Password again').fill(password)
            await checkScreen(page, testInfo, `setup1-${tag}`)

            await page.getByRole('button', { name: 'Next' }).click()
            await expect(
              page.getByRole('heading', { name: 'Language and time zone' }),
            ).toBeVisible()
            await checkScreen(page, testInfo, `setup2-${tag}`)

            await page.getByRole('button', { name: 'Next' }).click()
            await checkScreen(page, testInfo, `setup3-${tag}`)
            await page.getByRole('radio', { name: /Turn on transcription/ }).check({ force: true })
            await checkScreen(page, testInfo, `setup3on-${tag}`)

            await page.getByRole('button', { name: 'Back' }).click()
            await page.getByRole('radio', { name: 'Magyar' }).check({ force: true })
            await expect(page.getByRole('heading', { name: 'Nyelv és időzóna' })).toBeVisible()
            await checkScreen(page, testInfo, `setup2hu-${tag}`)
          })

          test(`AC-15: axe finds nothing on login and the wrong password state (${locale} ${colorScheme} ${String(width)})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await createAdmin(headers)
            const tag = `${colorScheme}-${String(width)}-${locale.slice(0, 2)}`
            await page.goto('/login')
            await expect(page.getByRole('textbox', { name: /E-?mail/i })).toBeVisible()
            await checkScreen(page, testInfo, `login-${tag}`)

            await page.getByRole('textbox', { name: /E-?mail/i }).fill(adminEmail)
            await page.locator('#password').fill('not the password')
            await page.locator('button[type=submit]').click()
            await expect(page.getByRole('alert')).toBeVisible()
            await checkScreen(page, testInfo, `loginerr-${tag}`)
          })
        })
      }
    }
  }
})
