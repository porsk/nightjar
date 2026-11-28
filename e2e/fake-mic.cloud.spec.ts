import { expect, test } from '@playwright/test'
import { fakeMic } from './support/fake-mic.ts'
import {
  adminUsername,
  createAdmin,
  password,
  readTranscripts,
  resetDatabase,
  setEntryLanguage,
  turnTranscriptionOn,
  uniqueIp,
} from './support/server.ts'

test.use({ ...fakeMic('hu-sample.wav'), timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

test.describe('010-cloud-transcription: recording with the Hungarian clip', () => {
  test('AC-14: a recording with Soniox active is transcribed by the cloud engine and labelled', async ({
    page,
    context,
  }) => {
    await resetDatabase()
    const headers = { 'x-forwarded-for': uniqueIp() }
    await context.setExtraHTTPHeaders(headers)
    await createAdmin(headers)
    await setEntryLanguage('hu')
    await page.goto('/login')
    await page.getByLabel('Username').fill(adminUsername)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
    await turnTranscriptionOn()
    await page.request.put('/api/v1/admin/transcription/providers/soniox/secrets', {
      data: { apiKey: 'e2e-key-1' },
    })
    await page.request.post('/api/v1/admin/transcription/providers/soniox/use')

    await page.getByRole('link', { name: 'Start recording' }).click()
    await expect(page.getByRole('timer', { name: 'Elapsed time' })).not.toHaveText('00:00', {
      timeout: 3000,
    })
    await expect(page.locator('body')).not.toContainText('stays on your own server')
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Stop' }).click()

    await expect(page.getByTestId('transcript')).toHaveText('Fixture transcript 1', {
      timeout: 20_000,
    })
    await expect(page.locator('.mdl')).toContainText('Soniox')
    const [saved] = await readTranscripts()
    expect(saved).toMatchObject({ model: 'soniox', language: 'hu' })
  })
})
