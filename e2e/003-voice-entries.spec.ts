import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { fakeTexts } from '../apps/server/src/modules/transcription/fake-transcriber.ts'
import {
  adminEmail,
  createAdmin,
  modelFolderExists,
  password,
  readRecordings,
  readTranscripts,
  resetDatabase,
  seedEntry,
  seedRecording,
  turnTranscriptionOn,
  uniqueIp,
} from './support/server.ts'

const clip = path.join(import.meta.dirname, 'fixtures', 'en-sample.wav')

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(adminEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

async function entryWith(recording: Omit<Parameters<typeof seedRecording>[0], 'entryId'>) {
  const { entryId } = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
  const { id } = await seedRecording({ ...recording, entryId })
  return { entryId, recordingId: id }
}

test.describe('003-voice-entries: upload and transcripts', () => {
  test.beforeEach(async ({ page }) => {
    await createAdmin(headers)
    await signIn(page)
  })

  test('AC-8: an audio file from Home becomes a new entry with a recording', async ({ page }) => {
    await page.getByRole('link', { name: 'Upload an audio file' }).click()
    await expect(page.getByRole('heading', { name: 'Upload an audio file' })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(clip)
    await expect(page.getByText('en-sample.wav')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'English' })).toBeChecked()
    await page.getByRole('button', { name: 'Upload' }).click()

    await expect(page.getByTestId('recording-card')).toBeVisible()
    await expect(page.getByText('Not transcribed.')).toBeVisible()
    const [saved] = await readRecordings()
    expect(saved).toMatchObject({ status: 'skipped', language: 'en' })
  })

  test('AC-12: with transcription on, an uploaded file is transcribed and the text appears', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.getByRole('link', { name: 'Upload an audio file' }).click()
    await page.locator('input[type="file"]').setInputFiles(clip)
    await page.getByRole('radio', { name: 'Automatic' }).check({ force: true })
    await page.getByRole('button', { name: 'Upload' }).click()

    await expect(page.getByText('Transcribing…')).toBeVisible()
    await expect(page.getByTestId('transcript')).toHaveText(fakeTexts.hu, { timeout: 20_000 })
    await expect(page.getByText('Transcribing…')).toBeHidden()
  })

  test('AC-16: a failed transcription can be tried again and then shows the text', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    const { entryId } = await entryWith({ status: 'failed', language: 'en' })
    await page.goto(`/entries/${entryId}`)
    await expect(page.getByRole('alert')).toContainText('Transcription failed.')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()

    await page.getByRole('button', { name: 'Try again' }).click()

    await expect(page.getByTestId('transcript')).toHaveText(fakeTexts.en, { timeout: 20_000 })
  })

  test('AC-17: an edited transcript is saved, kept after a reload and Cancel restores the old text', async ({
    page,
  }) => {
    const { entryId } = await entryWith({
      status: 'done',
      transcript: { text: 'The old words.', language: 'en' },
    })
    await page.goto(`/entries/${entryId}`)

    await page.getByRole('button', { name: 'Edit transcript' }).click()
    await page.getByRole('textbox', { name: 'Edit transcript' }).fill('Throwaway')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('transcript')).toHaveText('The old words.')

    await page.getByRole('button', { name: 'Edit transcript' }).click()
    await page.getByRole('textbox', { name: 'Edit transcript' }).fill('The brand new words.')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('transcript')).toHaveText('The brand new words.')

    await page.reload()
    await expect(page.getByTestId('transcript')).toHaveText('The brand new words.')
    expect((await readTranscripts())[0]).toMatchObject({ is_user_edited: true })
  })

  test('AC-19: the player shows the length and plays the recording', async ({
    page,
    browserName,
  }) => {
    const { entryId } = await entryWith({
      status: 'done',
      transcript: { text: 'Listen to this.', language: 'en' },
    })
    await page.goto(`/entries/${entryId}`)
    await expect(page.getByText(/^0:00 \/ 0:0\d$/)).toBeVisible()
    test.skip(browserName !== 'chromium', 'the Playwright WebKit build cannot play audio')

    await page.getByRole('button', { name: 'Play' }).click()

    await expect
      .poll(() =>
        page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime),
      )
      .toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  })

  test('AC-20: with transcription off the card says so and points to Settings', async ({
    page,
  }) => {
    const { entryId } = await entryWith({ status: 'skipped' })
    await page.goto(`/entries/${entryId}`)

    await expect(page.getByText('Not transcribed.')).toBeVisible()
    await expect(page.getByText(/You can turn it on in Settings/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  })
})

test.describe('003-voice-entries: transcription in Settings', () => {
  test.beforeEach(async ({ page }) => {
    await createAdmin(headers)
    await signIn(page)
  })

  test('AC-21: turning it on downloads the model with progress and ends with the ready line', async ({
    page,
  }) => {
    await page.goto('/settings')
    const toggle = page.getByRole('switch', { name: 'Transcription' })
    await expect(toggle).not.toBeChecked()
    await toggle.click()

    await expect(page.getByText('Downloading model…')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Downloading model…' })).toBeVisible()
    await expect(
      page.getByText('Model downloaded. New recordings will be transcribed.'),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('progressbar')).toBeHidden()
    expect(modelFolderExists()).toBe(true)
  })

  test('AC-24: recordings that were never transcribed are offered and queued on request', async ({
    page,
  }) => {
    const first = await entryWith({ status: 'skipped', language: 'en' })
    const second = await entryWith({ status: 'skipped', language: 'en' })
    await turnTranscriptionOn()
    await page.goto('/settings')

    await expect(
      page.getByText('2 recordings were never transcribed. Transcribe them now?'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Transcribe now' }).click()
    await expect(page.getByText(/never transcribed/)).toBeHidden()

    await expect
      .poll(async () => (await readRecordings()).map((row) => row.status), { timeout: 30_000 })
      .toEqual(['done', 'done'])
    await page.goto(`/entries/${first.entryId}`)
    await expect(page.getByTestId('transcript')).toHaveText(fakeTexts.en)
    await page.goto(`/entries/${second.entryId}`)
    await expect(page.getByTestId('transcript')).toHaveText(fakeTexts.en)
  })

  test('AC-24: Not now hides the question until Settings is opened again', async ({ page }) => {
    await entryWith({ status: 'skipped' })
    await turnTranscriptionOn()
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByText(/never transcribed/)).toBeHidden()

    await page.goto('/')
    await page.goto('/settings')
    await expect(page.getByText(/1 recordings were never transcribed/)).toBeVisible()
  })
})

test.describe('003-voice-entries: setup wizard carry-over', () => {
  test('AC-21: choosing transcription in the wizard starts the download after the first login', async ({
    page,
  }) => {
    await createAdmin(headers, 'en', true)
    await signIn(page)
    await page.goto('/settings')

    await expect(
      page.getByText('Model downloaded. New recordings will be transcribed.'),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('switch', { name: 'Transcription' })).toBeChecked()
    expect(modelFolderExists()).toBe(true)
  })
})
