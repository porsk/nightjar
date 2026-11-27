import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import { adminUsername, createAdmin, password, resetDatabase, uniqueIp } from './support/server.ts'

const viewports = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

test.describe('006-settings: Settings is accessible and looks right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots',
  )

  for (const locale of ['en-US', 'hu-HU']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        const tag = `${colorScheme}-${String(width)}-${locale.slice(0, 2)}`
        test.describe(tag, () => {
          test.use({ locale, colorScheme, viewport: viewports[width] })

          test(`AC-12: axe finds nothing on Settings (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await createAdmin(headers, locale === 'hu-HU' ? 'hu' : 'en')

            await page.goto('/login')
            await page
              .getByRole('textbox', { name: /Felhasználónév|Username/i })
              .fill(adminUsername)
            await page.locator('#password').fill(password)
            await page.locator('button[type=submit]').click()
            await page
              .getByRole('link', { name: /Settings|Beállítások/ })
              .first()
              .click()
            await expect(page.getByRole('heading', { name: /Settings|Beállítások/ })).toBeVisible()
            await expect(page.getByLabel(/Time zone|Időzóna/)).toBeVisible()

            const results = await new AxeBuilder({ page }).analyze()
            expect(results.violations, tag).toEqual([])
            await expectLayout(page, `settings ${tag}`)
            const file = `settings-${tag}.png`
            await page.screenshot({ path: testInfo.outputPath(file), fullPage: true })
            await testInfo.attach(file, {
              path: testInfo.outputPath(file),
              contentType: 'image/png',
            })
          })
        })
      }
    }
  }
})
