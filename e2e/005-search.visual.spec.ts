import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import {
  adminUsername,
  createAdmin,
  password,
  resetDatabase,
  seedTimelineEntry,
  uniqueIp,
} from './support/server.ts'

const viewports = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

async function checkScreen(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, name).toEqual([])
  await expectLayout(page, name)
  const file = `${name}.png`
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: true })
  await testInfo.attach(name, { path: testInfo.outputPath(file), contentType: 'image/png' })
}

test.describe('005-search: screens are accessible and look right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots',
  )

  for (const locale of ['en-US', 'hu-HU']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        const tag = `${colorScheme}-${String(width)}-${locale.slice(0, 2)}`
        test.describe(`${locale} ${colorScheme} ${String(width)}`, () => {
          test.use({
            locale,
            colorScheme,
            viewport: viewports[width],
            timezoneId: 'Europe/Budapest',
            serviceWorkers: 'block',
          })

          test(`AC-11: axe finds nothing on the results and the no-results screen (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await page.clock.setFixedTime(new Date('2026-11-26T20:30:00Z'))
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            await seedTimelineEntry({
              bodyMd: '',
              entryDate: '2026-11-26',
              createdAt: '2026-11-26T19:42:00Z',
              recordings: [
                {
                  status: 'done',
                  durationMs: 60_000,
                  transcript:
                    'Ma reggel korán keltem, és megint eszembe jutott a költözés. Szerintem készen állok rá, csak még el kell mondanom a szüleimnek.',
                },
              ],
            })
            await seedTimelineEntry({
              bodyMd:
                'Elkezdtem pakolni a könyveket, többet találtam, mint gondoltam. A költözéshez még dobozok kellenek.',
              entryDate: '2026-11-23',
              createdAt: '2026-11-23T17:30:00Z',
            })
            await seedTimelineEntry({
              bodyMd:
                'Annával a költözésről beszélgettünk, szerinte jövő tavasz lenne a jó időpont.',
              entryDate: '2026-11-14',
              createdAt: '2026-11-14T16:15:00Z',
            })
            await page.goto('/login')
            await page.getByLabel(hu ? 'Felhasználónév' : 'Username').fill(adminUsername)
            await page.getByLabel(hu ? 'Jelszó' : 'Password').fill(password)
            await page.getByRole('button', { name: hu ? 'Belépés' : 'Sign in' }).click()
            await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()
            await page.goto('/search')
            const label = hu ? 'Keresés' : 'Search'
            const box = page.getByRole('searchbox', { name: label })

            await box.fill('költözés')
            await expect(page.locator('a.hit')).toHaveCount(3)
            await checkScreen(page, testInfo, `search-${tag}`)

            await box.fill('hajóút')
            await expect(page.getByText(hu ? 'Nincs találat' : 'No results')).toBeVisible()
            await checkScreen(page, testInfo, `searchempty-${tag}`)
          })
        })
      }
    }
  }
})
