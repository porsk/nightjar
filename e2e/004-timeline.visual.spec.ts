import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import {
  adminUsername,
  createAdmin,
  password,
  resetDatabase,
  seedBulkEntries,
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

test.describe('004-timeline: screens are accessible and look right', () => {
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
          })

          test(`AC-12: axe finds nothing on Home, the timeline and its empty states (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await page.clock.setFixedTime(new Date('2026-11-26T20:30:00Z'))
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            await page.goto('/login')
            await page.getByLabel(hu ? 'Felhasználónév' : 'Username').fill(adminUsername)
            await page.getByLabel(hu ? 'Jelszó' : 'Password').fill(password)
            await page.getByRole('button', { name: hu ? 'Belépés' : 'Sign in' }).click()
            const timelineName = hu ? 'Idővonal' : 'Timeline'

            await expect(
              page.getByText(hu ? 'Ma még nincs bejegyzés.' : 'No entries today yet.'),
            ).toBeVisible()
            await checkScreen(page, testInfo, `home-empty-${tag}`)
            await page.goto('/timeline')
            await expect(page.getByRole('heading', { name: timelineName, level: 1 })).toBeVisible()
            await expect(
              page.getByText(
                hu
                  ? 'Még nincs bejegyzésed. A Ma oldalon felvehetsz vagy írhatsz egyet.'
                  : 'No entries yet. Record or write one on the Today page.',
              ),
            ).toBeVisible()
            await checkScreen(page, testInfo, `timeline-empty-${tag}`)

            const day = '2026-11-26'
            const long =
              'Hosszú nap, de jó értelemben. Délelőtt a megbeszélés jobban sikerült, mint vártam, délután pedig kiszaladtam a partra és sétáltam egy jó nagyot.'
            await seedTimelineEntry({
              bodyMd: '',
              entryDate: day,
              createdAt: '2026-11-26T19:42:00Z',
              recordings: [{ status: 'transcribing', durationMs: 108_000 }],
            })
            await seedTimelineEntry({
              bodyMd: 'Ebéd Annával. Mesélt az új lakásról.',
              entryDate: day,
              createdAt: '2026-11-26T11:05:00Z',
            })
            await seedTimelineEntry({
              bodyMd: '',
              entryDate: '2026-11-25',
              createdAt: '2026-11-25T21:10:00Z',
              recordings: [{ status: 'done', durationMs: 52_000, transcript: long }],
            })
            await seedTimelineEntry({
              bodyMd: '',
              entryDate: '2026-11-23',
              createdAt: '2026-11-23T07:05:00Z',
              recordings: [{ status: 'skipped', durationMs: 151_000 }],
            })
            await seedTimelineEntry({
              bodyMd: '',
              entryDate: '2026-11-23',
              createdAt: '2026-11-23T06:40:00Z',
              recordings: [{ status: 'failed', durationMs: 15_000 }],
            })
            await seedTimelineEntry({
              bodyMd: long,
              entryDate: '2025-12-05',
              createdAt: '2025-12-05T18:00:00Z',
            })

            await page.goto('/')
            await expect(
              page
                .getByRole('region', { name: hu ? 'Mai bejegyzések' : "Today's entries" })
                .getByRole('link'),
            ).toHaveCount(2)
            await checkScreen(page, testInfo, `home-${tag}`)

            await page.goto('/timeline')
            await expect(
              page.getByRole('region', { name: timelineName }).getByRole('link'),
            ).toHaveCount(6)
            await checkScreen(page, testInfo, `timeline-${tag}`)

            await page.getByRole('region', { name: timelineName }).getByRole('link').first().click()
            await expect(page.getByTestId('entry-body')).toBeAttached()
            await checkScreen(page, testInfo, `entry-${tag}`)
          })

          test(`AC-12: axe finds nothing while more entries load (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await page.clock.setFixedTime(new Date('2026-11-26T20:30:00Z'))
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            await seedBulkEntries(40, '2026-11-26T19:00:00Z')
            await page.goto('/login')
            await page.getByLabel(hu ? 'Felhasználónév' : 'Username').fill(adminUsername)
            await page.getByLabel(hu ? 'Jelszó' : 'Password').fill(password)
            await page.getByRole('button', { name: hu ? 'Belépés' : 'Sign in' }).click()
            await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()

            let release: () => void = () => undefined
            const held = new Promise<void>((resolve) => {
              release = resolve
            })
            await page.route('**/api/v1/entries?*before=*', async (route) => {
              await held
              await route.continue()
            })
            await page.goto('/timeline')
            await expect(page.getByText('Bulk entry 40')).toBeVisible()
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight)
            })
            await expect(
              page.getByText(hu ? 'További bejegyzések betöltése…' : 'Loading more entries…'),
            ).toBeVisible()
            await checkScreen(page, testInfo, `timeline-loading-${tag}`)
            release()
          })
        })
      }
    }
  }
})
