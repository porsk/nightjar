import { expect, test, type Page } from '@playwright/test'
import { fakeTexts } from '../../apps/server/src/modules/transcription/fake-transcriber.ts'
import {
  adminEmail,
  createAdmin,
  password,
  readRecordings,
  readTranscripts,
  resetDatabase,
  setEntryLanguage,
  turnTranscriptionOn,
  uniqueIp,
} from './server.ts'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(adminEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
}

const timer = (page: Page) => page.getByRole('timer', { name: 'Elapsed time' })
const barHeights = (page: Page) =>
  page
    .getByTestId('meter')
    .locator('span')
    .evaluateAll((bars) => bars.map((bar) => (bar as HTMLElement).style.height))

/** The recorder tests that run once per language, each with its own fake microphone clip. */
export function defineVoiceTests(language: 'hu' | 'en') {
  const languageName = language === 'hu' ? 'Magyar' : 'English'

  test.describe(`003-voice-entries: recording with the ${languageName} clip`, () => {
    test.beforeEach(async ({ context, page }) => {
      await resetDatabase()
      const headers = { 'x-forwarded-for': uniqueIp() }
      await context.setExtraHTTPHeaders(headers)
      await createAdmin(headers)
      await setEntryLanguage(language)
      await signIn(page)
    })

    test('AC-1: the recorder opens, the timer counts up and the meter follows the microphone', async ({
      page,
    }) => {
      await page.getByRole('link', { name: 'Start recording' }).click()
      await expect(page.getByText('Recording', { exact: true })).toBeVisible()
      await expect(timer(page)).toHaveText('00:00')
      await expect(timer(page)).not.toHaveText('00:00', { timeout: 3000 })

      const first = await barHeights(page)
      await page.waitForTimeout(1500)
      const later = await barHeights(page)
      expect(new Set(later).size).toBeGreaterThan(1)
      expect(later).not.toEqual(first)
    })

    test('AC-2: pausing stops the timer, resuming goes on and the saved length is the time recorded', async ({
      page,
    }) => {
      await page.getByRole('link', { name: 'Start recording' }).click()
      await expect(timer(page)).toHaveText('00:00')
      const startedAt = Date.now()
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Pause' }).click()
      const recordedBeforePause = Date.now() - startedAt
      await expect(page.getByText('Paused', { exact: true })).toBeVisible()
      const frozen = await timer(page).textContent()
      await page.waitForTimeout(2500)
      await expect(timer(page)).toHaveText(frozen ?? '')

      await page.getByRole('button', { name: 'Resume' }).click()
      const resumedAt = Date.now()
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Stop' }).click()
      const recorded = recordedBeforePause + (Date.now() - resumedAt)

      await expect(page.getByTestId('recording-card')).toBeVisible()
      const [saved] = await readRecordings()
      expect(Math.abs((saved?.duration_ms ?? 0) - recorded)).toBeLessThan(500)
    })

    test('AC-4: discarding asks first, keeping goes on and confirming sends nothing', async ({
      page,
    }) => {
      const uploads: string[] = []
      page.on('request', (request) => {
        if (request.url().endsWith('/api/v1/recordings')) uploads.push(request.method())
      })
      await page.getByRole('link', { name: 'Start recording' }).click()
      await expect(timer(page)).not.toHaveText('00:00', { timeout: 3000 })

      await page.getByRole('button', { name: 'Discard' }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Discard the recording?' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Keep recording' }).click()
      await expect(dialog).toBeHidden()
      const afterKeep = await timer(page).textContent()
      await expect(timer(page)).not.toHaveText(afterKeep ?? '', { timeout: 3000 })

      await page.getByRole('button', { name: 'Discard' }).click()
      await dialog.getByRole('button', { name: 'Discard' }).click()
      await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
      expect(uploads).toEqual([])
      expect(await readRecordings()).toHaveLength(0)
    })

    test('AC-3: stopping opens the entry with the recording, Record another adds a second one', async ({
      page,
    }) => {
      await page.getByRole('link', { name: 'Start recording' }).click()
      await expect(timer(page)).not.toHaveText('00:00', { timeout: 3000 })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByTestId('recording-card')).toHaveCount(1)
      await expect(page.getByText('Not transcribed.')).toBeVisible()
      const entryUrl = page.url()

      await page.getByRole('link', { name: 'Record another' }).click()
      await expect(timer(page)).not.toHaveText('00:00', { timeout: 3000 })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByTestId('recording-card')).toHaveCount(2)
      expect(page.url()).toBe(entryUrl)
      const saved = await readRecordings()
      expect(new Set(saved.map((row) => row.entry_id)).size).toBe(1)
      expect(saved.map((row) => row.language)).toEqual([language, language])
    })

    test('AC-12: the recording is transcribed in the background and the text appears without a reload', async ({
      page,
    }) => {
      await turnTranscriptionOn()
      await page.getByRole('link', { name: 'Start recording' }).click()
      await expect(timer(page)).not.toHaveText('00:00', { timeout: 3000 })
      await page.waitForTimeout(1000)
      await page.getByRole('button', { name: 'Stop' }).click()

      await expect(page.getByText('Transcribing…')).toBeVisible()
      await expect(page.getByTestId('transcript')).toHaveText(fakeTexts[language], {
        timeout: 20_000,
      })
      await expect(page.getByText(languageName, { exact: true })).toBeVisible()
      const [stored] = await readTranscripts()
      expect(stored).toMatchObject({ language, text: fakeTexts[language] })
    })
  })
}
