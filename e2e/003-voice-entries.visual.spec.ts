import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { fakeMic } from './support/fake-mic.ts'
import {
  adminEmail,
  createAdmin,
  password,
  resetDatabase,
  seedEntry,
  seedRecording,
  uniqueIp,
} from './support/server.ts'

const clip = path.join(import.meta.dirname, 'fixtures', 'en-sample.wav')
const viewports = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }

test.use(fakeMic('en-sample.wav'))

async function checkScreen(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, name).toEqual([])
  const file = `${name}.png`
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: true })
  await testInfo.attach(name, { path: testInfo.outputPath(file), contentType: 'image/png' })
}

const downloading = {
  enabled: true,
  state: 'downloading',
  downloadedBytes: 340_000_000,
  totalBytes: 560_000_000,
  backlogCount: 0,
}

test.describe('003-voice-entries: screens are accessible and look right', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one browser is enough for screenshots, and only Chromium has the fake microphone',
  )

  for (const locale of ['en-US', 'hu-HU']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [390, 1280] as const) {
        const tag = `${locale.slice(0, 2)}-${colorScheme}-${String(width)}`
        test.describe(`${locale} ${colorScheme} ${String(width)}`, () => {
          test.use({
            locale,
            colorScheme,
            viewport: viewports[width],
            timezoneId: 'Europe/Budapest',
            serviceWorkers: 'block',
          })

          test(`AC-28: axe finds nothing on Home, the recorder, the upload screen and the entry cards (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            const t = hu
              ? {
                  email: 'E-mail cím',
                  password: 'Jelszó',
                  signIn: 'Belépés',
                  record: 'Felvétel indítása',
                  recording: 'Felvétel folyamatban',
                  discard: 'Elvetés',
                  discardTitle: 'Elveted a felvételt?',
                  keep: 'Felvétel folytatása',
                  uploadLink: 'Hangfájl feltöltése',
                  upload: 'Feltöltés',
                  edit: 'Átirat szerkesztése',
                  working: 'Átírás folyamatban…',
                  failed: 'Az átírás nem sikerült.',
                  off: 'Nincs átírva.',
                }
              : {
                  email: 'Email',
                  password: 'Password',
                  signIn: 'Sign in',
                  record: 'Start recording',
                  recording: 'Recording',
                  discard: 'Discard',
                  discardTitle: 'Discard the recording?',
                  keep: 'Keep recording',
                  uploadLink: 'Upload an audio file',
                  upload: 'Upload',
                  edit: 'Edit transcript',
                  working: 'Transcribing…',
                  failed: 'Transcription failed.',
                  off: 'Not transcribed.',
                }

            await page.goto('/login')
            await page.getByLabel(t.email).fill(adminEmail)
            await page.getByLabel(t.password).fill(password)
            await page.getByRole('button', { name: t.signIn }).click()
            await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()
            await checkScreen(page, testInfo, `home-${tag}`)

            await page.getByRole('link', { name: t.record }).first().click()
            await expect(page.getByText(t.recording, { exact: true })).toBeVisible()
            await expect(page.getByRole('timer')).not.toHaveText('00:00', { timeout: 3000 })
            await checkScreen(page, testInfo, `recorder-${tag}`)
            await page.getByRole('button', { name: t.discard }).click()
            await expect(page.getByRole('alertdialog', { name: t.discardTitle })).toBeVisible()
            await checkScreen(page, testInfo, `recorder-discard-${tag}`)
            await page.getByRole('button', { name: t.keep }).click()
            await page.getByRole('button', { name: t.discard }).click()
            await page.getByRole('alertdialog').getByRole('button', { name: t.discard }).click()
            await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()

            await page.goto('/upload')
            await expect(page.locator('input[type="file"]')).toBeAttached()
            await checkScreen(page, testInfo, `upload-empty-${tag}`)
            await page.locator('input[type="file"]').setInputFiles(clip)
            await expect(page.getByText('en-sample.wav')).toBeVisible()
            await checkScreen(page, testInfo, `upload-ready-${tag}`)

            let release = () => {}
            const gate = new Promise<void>((resolve) => {
              release = resolve
            })
            await page.route('**/api/v1/recordings', async (route) => {
              await gate
              await route.continue()
            })
            await page.getByRole('button', { name: t.upload }).click()
            await expect(page.getByRole('progressbar')).toBeVisible()
            await checkScreen(page, testInfo, `upload-progress-${tag}`)
            release()
            await expect(page.getByTestId('recording-card')).toBeVisible()
            await page.unroute('**/api/v1/recordings')

            const { entryId } = await seedEntry({
              bodyMd: 'A long day, in a good way.',
              entryDate: '2026-11-26',
            })
            await seedRecording({
              entryId,
              status: 'done',
              language: 'hu',
              transcript: {
                text: 'Ma reggel korán keltem, és megint eszembe jutott a költözés.',
                language: 'hu',
              },
            })
            await seedRecording({ entryId, status: 'transcribing' })
            await page.goto(`/entries/${entryId}`)
            await expect(page.getByText(t.working)).toBeVisible()
            await checkScreen(page, testInfo, `entry-cards-${tag}`)

            await page.getByRole('button', { name: t.edit }).click()
            await expect(page.getByRole('textbox', { name: t.edit })).toBeVisible()
            await checkScreen(page, testInfo, `entry-editing-${tag}`)

            const failed = await seedEntry({ bodyMd: '', entryDate: '2026-11-23' })
            await seedRecording({ entryId: failed.entryId, status: 'failed', language: 'hu' })
            await page.goto(`/entries/${failed.entryId}`)
            await expect(page.getByText(t.failed)).toBeVisible()
            await checkScreen(page, testInfo, `entry-failed-${tag}`)

            const off = await seedEntry({ bodyMd: '', entryDate: '2026-11-23' })
            await seedRecording({ entryId: off.entryId, status: 'skipped' })
            await page.goto(`/entries/${off.entryId}`)
            await expect(page.getByText(t.off)).toBeVisible()
            await checkScreen(page, testInfo, `entry-off-${tag}`)
          })

          test(`AC-28: axe finds nothing on the admin part of Settings in every state (${tag})`, async ({
            page,
            context,
          }, testInfo) => {
            await resetDatabase()
            const headers = { 'x-forwarded-for': uniqueIp() }
            await context.setExtraHTTPHeaders(headers)
            const hu = locale === 'hu-HU'
            await createAdmin(headers, hu ? 'hu' : 'en')
            await page.goto('/login')
            await page.getByLabel(hu ? 'E-mail cím' : 'Email').fill(adminEmail)
            await page.getByLabel(hu ? 'Jelszó' : 'Password').fill(password)
            await page.getByRole('button', { name: hu ? 'Belépés' : 'Sign in' }).click()
            await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()

            await page.goto('/settings')
            await expect(page.getByRole('switch')).not.toBeChecked()
            await checkScreen(page, testInfo, `settings-off-${tag}`)

            await page.route('**/api/v1/admin/transcription', (route) =>
              route.fulfill({ json: downloading }),
            )
            await page.goto('/settings')
            await expect(page.getByRole('progressbar')).toBeVisible()
            await checkScreen(page, testInfo, `settings-downloading-${tag}`)

            await page.unroute('**/api/v1/admin/transcription')
            await page.route('**/api/v1/admin/transcription', (route) =>
              route.fulfill({
                json: {
                  ...downloading,
                  state: 'ready',
                  downloadedBytes: 560_000_000,
                  backlogCount: 14,
                },
              }),
            )
            await page.goto('/settings')
            await expect(
              page.getByText(hu ? 'A modell letöltve' : 'Model downloaded'),
            ).toBeVisible()
            await checkScreen(page, testInfo, `settings-ready-${tag}`)

            await page.unroute('**/api/v1/admin/transcription')
            await page.route('**/api/v1/admin/transcription', (route) =>
              route.fulfill({ json: { ...downloading, state: 'failed', downloadedBytes: 0 } }),
            )
            await page.goto('/settings')
            await expect(page.getByRole('alert')).toBeVisible()
            await checkScreen(page, testInfo, `settings-failed-${tag}`)
          })
        })
      }
    }
  }
})
