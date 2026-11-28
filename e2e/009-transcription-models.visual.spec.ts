import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import { fakeStatus, largeId, modelRow, turboId } from './support/models.ts'
import {
  adminUsername,
  createAdmin,
  password,
  resetDatabase,
  seedEntry,
  seedRecording,
  turnTranscriptionOn,
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

const statusRoute = '**/api/v1/admin/transcription'

async function showStatus(page: Page, status: object) {
  await page.unroute(statusRoute).catch(() => undefined)
  await page.route(statusRoute, (route) => route.fulfill({ json: status }))
  await page.goto('/settings')
}

const text = {
  en: {
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in',
    title: /on your mind/,
    inUse: 'In use',
    delete: 'Delete',
    deleteTitle: 'Delete the Turbo model?',
    menu: 'Recording actions',
    again: 'Transcribe again',
    replaceTitle: 'Replace your edits?',
    working: 'Transcribing again…',
    failed: 'Transcribing again failed.',
    diskFull: /enough disk space/,
  },
  hu: {
    username: 'Felhasználónév',
    password: 'Jelszó',
    signIn: 'Belépés',
    title: /fejedben/,
    inUse: 'Használatban',
    delete: 'Törlés',
    deleteTitle: 'Törlöd a Turbo modellt?',
    menu: 'Felvétel műveletei',
    again: 'Átírás újra',
    replaceTitle: 'Felülírjuk a javításaidat?',
    working: 'Újraírás folyamatban…',
    failed: 'Az újraírás nem sikerült.',
    diskFull: /Nincs elég hely/,
  },
}

test.describe('009-transcription-models: screens are accessible and look right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots',
  )

  for (const lang of ['en', 'hu'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        const tag = `${lang}-${colorScheme}-${String(width)}`
        const t = text[lang]
        test.describe(tag, () => {
          test.use({
            locale: lang === 'hu' ? 'hu-HU' : 'en-US',
            colorScheme,
            viewport: viewports[width],
            timezoneId: 'Europe/Budapest',
            serviceWorkers: 'block',
          })

          test.beforeEach(async ({ page, context }) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            await createAdmin(headers, lang)
            await page.goto('/login')
            await page.getByLabel(t.username).fill(adminUsername)
            await page.getByLabel(t.password).fill(password)
            await page.getByRole('button', { name: t.signIn }).click()
            await expect(page.getByRole('heading', { name: t.title })).toBeVisible()
          })

          test(`AC-26: axe finds nothing on the model list in every state (${tag})`, async ({
            page,
          }, testInfo) => {
            await showStatus(
              page,
              fakeStatus(
                modelRow(turboId, 'downloaded'),
                modelRow(largeId, 'downloading', {
                  downloadedBytes: 412_000_000,
                  useWhenReady: true,
                }),
              ),
            )
            await expect(page.getByRole('progressbar')).toBeVisible()
            await checkScreen(page, testInfo, `models-downloading-${tag}`)

            await showStatus(
              page,
              fakeStatus(modelRow(turboId, 'downloaded'), modelRow(largeId, 'downloaded'), {
                activeEngine: largeId,
                totalBytes: 1_069_126_342,
              }),
            )
            await expect(page.getByText(t.inUse)).toBeVisible()
            await checkScreen(page, testInfo, `models-use-${tag}`)

            await page.getByRole('button', { name: t.delete }).click()
            await expect(page.getByRole('alertdialog', { name: t.deleteTitle })).toBeVisible()
            await checkScreen(page, testInfo, `models-delete-${tag}`)
            await page.keyboard.press('Escape')

            await showStatus(
              page,
              fakeStatus(
                modelRow(turboId, 'downloaded'),
                modelRow(largeId, 'failed', { error: 'disk_full' }),
              ),
            )
            await expect(page.getByText(t.diskFull)).toBeVisible()
            await checkScreen(page, testInfo, `models-failed-${tag}`)
          })

          test(`AC-26: axe finds nothing on the recording menu, the confirm and the cards (${tag})`, async ({
            page,
          }, testInfo) => {
            await turnTranscriptionOn()
            const edited = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
            await seedRecording({
              entryId: edited.entryId,
              status: 'done',
              transcript: {
                text: 'Edited words.',
                language: 'en',
                model: turboId,
                isUserEdited: true,
              },
            })
            await page.goto(`/entries/${edited.entryId}`)
            await page.getByRole('button', { name: t.menu }).click()
            await expect(page.getByRole('menuitem', { name: t.again })).toBeVisible()
            await checkScreen(page, testInfo, `menu-open-${tag}`)

            await page.getByRole('menuitem', { name: t.again }).click()
            await expect(page.getByRole('alertdialog', { name: t.replaceTitle })).toBeVisible()
            await checkScreen(page, testInfo, `menu-confirm-${tag}`)
            await page.keyboard.press('Escape')

            await page.route('**/api/v1/transcription', (route) =>
              route.fulfill({ json: { state: 'off', engine: { id: turboId, kind: 'local' } } }),
            )
            await page.getByRole('button', { name: t.menu }).click()
            await expect(page.getByRole('menuitem', { name: t.again })).toHaveAttribute(
              'aria-disabled',
              'true',
            )
            await checkScreen(page, testInfo, `menu-disabled-${tag}`)
            await page.keyboard.press('Escape')

            const working = await seedEntry({ bodyMd: '', entryDate: '2026-11-24' })
            await seedRecording({
              entryId: working.entryId,
              status: 'transcribing',
              transcript: { text: 'Old words.', language: 'en', model: turboId },
            })
            await page.goto(`/entries/${working.entryId}`)
            await expect(page.getByText(t.working)).toBeVisible()
            await checkScreen(page, testInfo, `card-working-${tag}`)

            const failed = await seedEntry({ bodyMd: '', entryDate: '2026-11-23' })
            await seedRecording({
              entryId: failed.entryId,
              status: 'failed',
              transcript: { text: 'Old words.', language: 'en', model: largeId },
            })
            await page.goto(`/entries/${failed.entryId}`)
            await expect(page.getByText(t.failed)).toBeVisible()
            await checkScreen(page, testInfo, `card-failed-${tag}`)
          })
        })
      }
    }
  }
})
