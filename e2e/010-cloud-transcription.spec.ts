import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  adminUsername,
  cloudServer,
  createAdmin,
  password,
  readTranscripts,
  resetDatabase,
  seedEntry,
  seedRecording,
  turnTranscriptionOn,
  uniqueIp,
} from './support/server.ts'
import { turboId } from './support/models.ts'

const clip = path.join(import.meta.dirname, 'fixtures', 'hu-sample.wav')
const adminPath = '/api/v1/admin/transcription'

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

test.beforeEach(async ({ context, page }) => {
  await resetDatabase()
  const headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
  await createAdmin(headers)
  await page.goto('/login')
  await page.getByLabel('Username').fill(adminUsername)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
})

const providerRow = (page: Page, name: string): Locator =>
  page.getByTestId('provider-row').filter({ has: page.locator('b', { hasText: name }) })

/** Transcription on, a key saved and the provider switched to, through the admin API. */
async function useCloud(page: Page, id = 'soniox') {
  await turnTranscriptionOn()
  const key = await page.request.put(`${adminPath}/providers/${id}/secrets`, {
    data: { apiKey: 'e2e-key-1' },
  })
  expect(key.ok()).toBe(true)
  const use = await page.request.post(`${adminPath}/providers/${id}/use`)
  expect(use.ok()).toBe(true)
}

test.describe('010-cloud-transcription: engines in Settings', () => {
  test('AC-2: the list has a Local and a Cloud group and exactly one row in use', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')

    await expect(page.getByRole('group', { name: 'Local' })).toBeVisible()
    const cloud = page.getByRole('group', { name: 'Cloud' })
    await expect(cloud.getByText('Audio is sent to the provider to be transcribed')).toBeVisible()
    await expect(providerRow(page, 'Soniox').getByText(/About \$0\.10 per hour/)).toBeVisible()
    await expect(providerRow(page, 'Gladia').getByText(/About €0\.27 per hour/)).toBeVisible()
    await expect(providerRow(page, 'Soniox').getByText('No API key')).toBeVisible()
    await expect(page.getByText('In use')).toHaveCount(1)
  })

  test('AC-4: entering a key saves it masked and the field is empty again', async ({ page }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')
    const row = providerRow(page, 'Soniox')
    await row.getByRole('button', { name: 'Add API key' }).click()
    await row.getByLabel('API key').fill('typed-key-123')
    await row.getByRole('button', { name: 'Save' }).click()

    await expect(row.getByText('Key saved')).toBeVisible()
    await expect(row.getByText('••••••••')).toBeVisible()
    await expect(row.getByLabel('API key')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('typed-key-123')
  })

  test('AC-7: Check key says the key works and the vendor sees only the check call', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')
    const row = providerRow(page, 'Gladia')
    await row.getByRole('button', { name: 'Add API key' }).click()
    await row.getByLabel('API key').fill('typed-key-123')
    await row.getByRole('button', { name: 'Check key' }).click()

    await expect(row.getByRole('status')).toHaveText('The key works.')
    const seen = await cloudServer('requests')
    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /pre-recorded',
    ])

    await cloudServer('behaviour', { rejectKey: true })
    await row.getByRole('button', { name: 'Check key' }).click()
    await expect(row.getByRole('alert')).toHaveText("The provider didn't accept the key.")
  })

  test('AC-8: Use switches to the cloud engine and the hint and ready line name it', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.request.put(`${adminPath}/providers/soniox/secrets`, { data: { apiKey: 'k' } })
    await page.goto('/settings')
    await providerRow(page, 'Soniox').getByRole('button', { name: 'Use' }).click()

    await expect(providerRow(page, 'Soniox').getByText('In use')).toBeVisible()
    await expect(
      page.getByText('Recordings are turned into text by a cloud service (Soniox).'),
    ).toBeVisible()
    await expect(
      page.getByText('New recordings are transcribed in the cloud (Soniox).'),
    ).toBeVisible()
  })

  test('AC-9: a second page sees the key and the switch without reloading', async ({
    page,
    context,
  }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')
    const other = await context.newPage()
    await other.goto('/settings')
    await expect(providerRow(other, 'Soniox').getByText('No API key')).toBeVisible()

    await page.request.put(`${adminPath}/providers/soniox/secrets`, { data: { apiKey: 'k' } })
    await expect(providerRow(other, 'Soniox').getByText('Key saved')).toBeVisible()
    await page.request.post(`${adminPath}/providers/soniox/use`)
    await expect(providerRow(other, 'Soniox').getByText('In use')).toBeVisible()
  })
})

test.describe('010-cloud-transcription: a cloud job', () => {
  test('AC-22: a rejected key fails the recording with a reason and Try again after the fix works', async ({
    page,
  }) => {
    await useCloud(page)
    await cloudServer('behaviour', { validKey: 'another-key' })
    await page.goto('/upload')
    await page.locator('input[type="file"]').setInputFiles(clip)
    await page.getByRole('button', { name: 'Upload' }).click()

    const alert = page.getByRole('alert').filter({ hasText: 'Transcription failed.' })
    await expect(alert).toBeVisible({ timeout: 20_000 })
    await expect(alert).toContainText("The cloud service didn't accept the API key.")
    await expect(alert).toContainText('The recording is safe.')

    await cloudServer('behaviour', { validKey: 'e2e-key-1' })
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('transcript')).toHaveText('Fixture transcript 1', {
      timeout: 20_000,
    })
    expect((await readTranscripts()).map((row) => row.model)).toEqual(['soniox'])
  })

  test('AC-28: with Soniox active no page outside Settings says where audio goes', async ({
    page,
  }) => {
    await useCloud(page)
    const { entryId } = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
    await seedRecording({
      entryId,
      status: 'done',
      transcript: { text: 'Some words.', language: 'en', model: 'soniox' },
    })
    for (const url of ['/', `/entries/${entryId}`, '/upload', '/timeline']) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText('stays on your own server')
      await expect(page.locator('body')).not.toContainText(/transcribed in the cloud/i)
    }
    await page.goto(`/entries/${entryId}`)
    await expect(page.locator('.mdl')).toContainText('Soniox')
  })

  test('AC-27: local and cloud transcripts get their own labels', async ({ page }) => {
    await turnTranscriptionOn()
    const { entryId } = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
    await seedRecording({
      entryId,
      status: 'done',
      transcript: { text: 'Local words.', language: 'en', model: turboId },
    })
    await seedRecording({
      entryId,
      status: 'done',
      transcript: { text: 'Cloud words.', language: 'en', model: 'soniox' },
    })
    await page.goto(`/entries/${entryId}`)
    const labels = page.locator('.mdl')
    await expect(labels.nth(0)).toHaveText(/Model: Turbo/)
    await expect(labels.nth(1)).toHaveText(/Cloud service: Soniox/)
  })
})
