import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import {
  adminEmail,
  createAdmin,
  password,
  resetDatabase,
  seedEntry,
  uniqueIp,
} from './support/server.ts'

const viewports = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }
const body =
  'Hosszú nap, de jó értelemben. Délelőtt a megbeszélés jobban sikerült, mint vártam, délután pedig kiszaladtam a partra.\n\n- futás\n- **kávé**\n- [térkép](https://example.test)'

async function checkScreen(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, name).toEqual([])
  await expectLayout(page, name)
  const file = `${name}.png`
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: true })
  await testInfo.attach(name, { path: testInfo.outputPath(file), contentType: 'image/png' })
}

test.describe('002-text-entries: screens are accessible and look right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots',
  )

  for (const locale of ['en-US', 'hu-HU']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        test.describe(`${locale} ${colorScheme} ${String(width)}`, () => {
          test.use({
            locale,
            colorScheme,
            viewport: viewports[width],
            timezoneId: 'Europe/Budapest',
          })

          test(`AC-12: axe finds nothing on write, edit, date, delete and entry (${locale} ${colorScheme} ${String(width)})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await page.clock.setFixedTime(new Date('2026-11-26T20:30:00Z'))
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            const tag = `${colorScheme}-${String(width)}-${locale.slice(0, 2)}`
            const text = {
              email: hu ? 'E-mail cím' : 'Email',
              password: hu ? 'Jelszó' : 'Password',
              signIn: hu ? 'Belépés' : 'Sign in',
              write: hu ? 'Inkább írok' : "I'd rather write",
              textLabel: hu ? 'A bejegyzés szövege' : 'Entry text',
              newTitle: hu ? 'Új bejegyzés' : 'New entry',
              editTitle: hu ? 'Bejegyzés szerkesztése' : 'Edit entry',
              changeDate: hu ? 'Dátum módosítása' : 'Change date',
              deleteEntry: hu ? 'Bejegyzés törlése' : 'Delete entry',
              cancel: hu ? 'Mégse' : 'Cancel',
              deleteTitle: hu ? 'Törlöd ezt a bejegyzést?' : 'Delete this entry?',
              dateTitle: hu ? 'Melyik napról szól?' : 'Which day is it about?',
              saved: hu ? 'Mentve 21:30' : 'Saved 21:30',
            }

            await page.goto('/login')
            await page.getByLabel(text.email).fill(adminEmail)
            await page.getByLabel(text.password).fill(password)
            await page.getByRole('button', { name: text.signIn }).click()
            await page.getByRole('button', { name: text.write }).click()
            await expect(page.getByRole('heading', { name: text.newTitle })).toBeVisible()
            await page.getByLabel(text.textLabel).fill(body)
            await expect(page.getByText(text.saved)).toBeVisible()
            await checkScreen(page, testInfo, `write-${tag}`)

            await page.reload()
            await expect(page.getByRole('heading', { name: text.editTitle })).toBeVisible()
            await checkScreen(page, testInfo, `edit-${tag}`)

            await page.getByRole('button', { name: /^(Today|Ma),/ }).click()
            await expect(page.getByRole('dialog', { name: text.dateTitle })).toBeVisible()
            await checkScreen(page, testInfo, `date-${tag}`)
            await page.getByRole('button', { name: text.cancel }).click()

            await page.getByRole('button', { name: text.deleteEntry }).click()
            await expect(page.getByRole('alertdialog', { name: text.deleteTitle })).toBeVisible()
            await checkScreen(page, testInfo, `delete-${tag}`)
            await page.getByRole('button', { name: text.cancel }).click()

            const { entryId } = await seedEntry({ bodyMd: body, entryDate: '2026-11-26' })
            await page.goto(`/entries/${entryId}`)
            await expect(page.getByRole('button', { name: text.changeDate })).toBeVisible()
            await checkScreen(page, testInfo, `entry-${tag}`)
          })
        })
      }
    }
  }
})
