import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectLayout } from './support/layout.ts'
import { fakeProviders, fakeStatus, largeId, modelRow, turboId } from './support/models.ts'
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

const withEngines = (overrides: object = {}) =>
  fakeStatus(modelRow(turboId, 'downloaded'), modelRow(largeId, 'downloaded'), overrides)

const text = {
  en: {
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in',
    title: /on your mind/,
    addKey: 'Add API key',
    check: 'Check key',
    ok: 'The key works.',
    invalid: "The provider didn't accept the key.",
    unreachable: "Couldn't reach the provider. Try again later.",
    unreadable: "The saved key can't be read. Enter it again.",
    remove: 'Remove',
    removeTitle: 'Remove the Soniox API key?',
    inUse: 'In use',
    failedKey: "The cloud service didn't accept the API key.",
    failedDown: "The cloud service can't be reached right now.",
  },
  hu: {
    username: 'Felhasználónév',
    password: 'Jelszó',
    signIn: 'Belépés',
    title: /fejedben/,
    addKey: 'API-kulcs megadása',
    check: 'Kulcs ellenőrzése',
    ok: 'A kulcs működik.',
    invalid: 'A szolgáltató nem fogadta el a kulcsot.',
    unreachable: 'Nem sikerült elérni a szolgáltatót. Próbáld újra később.',
    unreadable: 'A mentett kulcs nem olvasható. Add meg újra.',
    remove: 'Eltávolítás',
    removeTitle: 'Eltávolítod a Soniox API-kulcsát?',
    inUse: 'Használatban',
    failedKey: 'A felhőszolgáltató nem fogadta el az API-kulcsot.',
    failedDown: 'A felhőszolgáltató most nem érhető el.',
  },
}

test.describe('010-cloud-transcription: screens are accessible and look right', () => {
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

          test(`AC-32: axe and layout are fine on the engine list and the key form in every state (${tag})`, async ({
            page,
          }, testInfo) => {
            await showStatus(
              page,
              withEngines({ providers: fakeProviders({ soniox: { configured: true } }) }),
            )
            await expect(page.getByText(t.inUse)).toBeVisible()
            await checkScreen(page, testInfo, `engines-local-${tag}`)

            await showStatus(
              page,
              withEngines({
                activeEngine: 'soniox',
                totalBytes: 0,
                providers: fakeProviders({ soniox: { configured: true } }),
                usage: [
                  { engine: 'soniox', audioMs: 11_520_000, estimatedCost: 0.32 },
                  { engine: 'gladia', audioMs: 0, estimatedCost: 0 },
                ],
              }),
            )
            await expect(page.getByTestId('provider-row').first()).toContainText(t.inUse)
            await checkScreen(page, testInfo, `engines-cloud-${tag}`)

            await showStatus(
              page,
              withEngines({ providers: fakeProviders({ soniox: { configured: true } }) }),
            )
            const gladia = page.getByTestId('provider-row').nth(1)
            await gladia.getByRole('button', { name: t.addKey }).click()
            await expect(gladia.getByLabel(/API/)).toBeVisible()
            await checkScreen(page, testInfo, `key-form-${tag}`)

            for (const [result, line] of [
              ['ok', t.ok],
              ['invalid_key', t.invalid],
              ['unreachable', t.unreachable],
            ] as const) {
              await page.unroute('**/providers/gladia/test').catch(() => undefined)
              await page.route('**/providers/gladia/test', (route) =>
                route.fulfill({ json: { result } }),
              )
              await gladia.getByLabel(/API/).fill('typed-key')
              await gladia.getByRole('button', { name: t.check }).click()
              await expect(gladia.getByText(line)).toBeVisible()
              await checkScreen(page, testInfo, `key-${result}-${tag}`)
            }

            await showStatus(
              page,
              withEngines({
                state: 'needs_key',
                activeEngine: 'soniox',
                totalBytes: 0,
                providers: fakeProviders({ soniox: { keyError: 'unreadable' } }),
              }),
            )
            await expect(page.getByText(t.unreadable).first()).toBeVisible()
            await checkScreen(page, testInfo, `key-unreadable-${tag}`)

            await showStatus(
              page,
              withEngines({ providers: fakeProviders({ soniox: { configured: true } }) }),
            )
            await page.getByRole('button', { name: t.remove }).click()
            await expect(page.getByRole('alertdialog', { name: t.removeTitle })).toBeVisible()
            await checkScreen(page, testInfo, `key-remove-${tag}`)
          })

          test(`AC-32: axe and layout are fine on the cards with cloud and local labels and the failed cloud cards (${tag})`, async ({
            page,
          }, testInfo) => {
            await turnTranscriptionOn()
            const labels = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
            await seedRecording({
              entryId: labels.entryId,
              status: 'done',
              transcript: { text: 'Cloud words.', language: 'en', model: 'soniox' },
            })
            await seedRecording({
              entryId: labels.entryId,
              status: 'done',
              transcript: { text: 'Local words.', language: 'en', model: turboId },
            })
            await page.goto(`/entries/${labels.entryId}`)
            await expect(page.locator('.mdl').first()).toBeVisible()
            await checkScreen(page, testInfo, `cards-${tag}`)

            const failed = await seedEntry({ bodyMd: '', entryDate: '2026-11-24' })
            await seedRecording({
              entryId: failed.entryId,
              status: 'failed',
              failure: 'api_key_invalid',
            })
            await seedRecording({
              entryId: failed.entryId,
              status: 'failed',
              failure: 'provider_unavailable',
              transcript: { text: 'Old words.', language: 'en', model: turboId },
            })
            await page.goto(`/entries/${failed.entryId}`)
            await expect(page.getByText(t.failedKey)).toBeVisible()
            await expect(page.getByText(t.failedDown)).toBeVisible()
            await checkScreen(page, testInfo, `card-failed-${tag}`)
          })
        })
      }
    }
  }
})
