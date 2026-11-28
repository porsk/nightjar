import { expect, test, type Page } from '@playwright/test'
import {
  adminUsername,
  createAdmin,
  password,
  readTranscripts,
  resetDatabase,
  seedEntry,
  seedModelFiles,
  seedRecording,
  turnTranscriptionOn,
  uniqueIp,
} from './support/server.ts'
import { largeId, turboId } from './support/models.ts'

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context, page }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
  await createAdmin(headers)
  await page.goto('/login')
  await page.getByLabel('Username').fill(adminUsername)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
})

const modelRow = (page: Page, name: string) =>
  page.getByTestId('model-row').filter({ has: page.getByText(name, { exact: true }) })

test.describe('009-transcription-models: choosing a model', () => {
  test('AC-2: turning transcription on shows the list with Turbo in use', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Transcription engine')).toBeHidden()
    await page.getByRole('switch', { name: 'Transcription' }).click()

    await expect(modelRow(page, 'Turbo').getByText('In use')).toBeVisible({ timeout: 30_000 })
    await expect(modelRow(page, 'Large-v3').getByText('Not downloaded')).toBeVisible()
    await expect(modelRow(page, 'Turbo').getByRole('button')).toHaveCount(0)
  })

  test('AC-3: Download fetches Large-v3 with progress and leaves Turbo in use', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')
    await modelRow(page, 'Large-v3').getByRole('button', { name: 'Download' }).click()

    await expect(modelRow(page, 'Large-v3').getByRole('progressbar')).toBeVisible()
    await expect(modelRow(page, 'Large-v3').getByText('Downloaded', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(modelRow(page, 'Turbo').getByText('In use')).toBeVisible()
  })

  test('AC-4: Use on Large-v3 downloads it and then switches', async ({ page }) => {
    await turnTranscriptionOn()
    await page.goto('/settings')
    await modelRow(page, 'Large-v3').getByRole('button', { name: 'Use' }).click()

    await expect(
      modelRow(page, 'Large-v3').getByText("We'll switch to it once it's downloaded."),
    ).toBeVisible()
    await expect(modelRow(page, 'Large-v3').getByText('In use')).toBeVisible({ timeout: 30_000 })
    await expect(modelRow(page, 'Turbo').getByText('Downloaded', { exact: true })).toBeVisible()
  })

  test('AC-7: deleting Turbo after switching asks first and then shows Not downloaded', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    seedModelFiles(largeId)
    await page.goto('/settings')
    await modelRow(page, 'Large-v3').getByRole('button', { name: 'Use' }).click()
    await expect(modelRow(page, 'Large-v3').getByText('In use')).toBeVisible()

    await modelRow(page, 'Turbo').getByRole('button', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete the Turbo model?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(modelRow(page, 'Turbo').getByText('Not downloaded')).toBeVisible()
  })

  test('AC-13: a second page sees the switch without reloading', async ({ page, context }) => {
    await turnTranscriptionOn()
    seedModelFiles(largeId)
    await page.goto('/settings')
    const other = await context.newPage()
    await other.goto('/settings')
    await expect(modelRow(other, 'Turbo').getByText('In use')).toBeVisible()

    await modelRow(page, 'Large-v3').getByRole('button', { name: 'Use' }).click()
    await expect(modelRow(other, 'Large-v3').getByText('In use')).toBeVisible()
    await expect(modelRow(other, 'Turbo').getByText('Downloaded', { exact: true })).toBeVisible()
  })
})

test.describe('009-transcription-models: transcribe again', () => {
  async function doneEntry(options: { edited?: boolean } = {}) {
    const { entryId } = await seedEntry({ bodyMd: 'A day', entryDate: '2026-11-25' })
    await seedRecording({
      entryId,
      status: 'done',
      transcript: {
        text: 'Old words from the first run.',
        language: 'en',
        model: turboId,
        isUserEdited: options.edited ?? false,
      },
    })
    return entryId
  }

  test('AC-17: the menu opens with the keyboard and Escape puts focus back', async ({ page }) => {
    await turnTranscriptionOn()
    const entryId = await doneEntry()
    await page.goto(`/entries/${entryId}`)
    const button = page.getByRole('button', { name: 'Recording actions' })
    await button.focus()
    await page.keyboard.press('ArrowDown')

    await expect(page.getByRole('menuitem', { name: 'Transcribe again' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await expect(button).toBeFocused()
  })

  test('AC-18: transcribing again shows the working line over the old text and then the new label', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    seedModelFiles(largeId)
    await page.goto('/settings')
    await modelRow(page, 'Large-v3').getByRole('button', { name: 'Use' }).click()
    await expect(modelRow(page, 'Large-v3').getByText('In use')).toBeVisible()
    const entryId = await doneEntry()
    await page.goto(`/entries/${entryId}`)
    await expect(page.locator('.mdl')).toContainText('Turbo')

    await page.getByRole('button', { name: 'Recording actions' }).click()
    await page.getByRole('menuitem', { name: 'Transcribe again' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Transcribing again…' })).toBeVisible()
    await expect(page.getByTestId('transcript')).toHaveText('Old words from the first run.')
    await expect(page.getByRole('button', { name: 'Edit transcript' })).toBeHidden()
    await expect(page.locator('.mdl')).toContainText('Large-v3', { timeout: 30_000 })
    await expect(page.getByText('Transcribing again…')).toBeHidden()
  })

  test('AC-19: an edited transcript asks first and the confirmed run replaces the edit', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    const entryId = await doneEntry({ edited: true })
    await page.goto(`/entries/${entryId}`)
    await page.getByRole('button', { name: 'Recording actions' }).click()
    await page.getByRole('menuitem', { name: 'Transcribe again' }).click()

    const dialog = page.getByRole('alertdialog', { name: 'Replace your edits?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Transcribe again' }).click()

    await expect(page.getByTestId('transcript')).not.toHaveText('Old words from the first run.', {
      timeout: 30_000,
    })
    const [saved] = await readTranscripts()
    expect(saved).toMatchObject({ is_user_edited: false, model: turboId })
  })
})
