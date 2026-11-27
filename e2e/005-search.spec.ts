import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { fakeTexts } from '../apps/server/src/modules/transcription/fake-transcriber.ts'
import { expectLayout } from './support/layout.ts'
import {
  adminUsername,
  createAdmin,
  password,
  resetDatabase,
  seedTimelineEntry,
  turnTranscriptionOn,
  uniqueIp,
} from './support/server.ts'

const clip = path.join(import.meta.dirname, 'fixtures', 'en-sample.wav')

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context, page }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
  await page.clock.setFixedTime(new Date('2026-11-26T20:30:00Z'))
  await createAdmin(headers)
  await page.goto('/login')
  await page.getByLabel('Username').fill(adminUsername)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /on your mind/ })).toBeVisible()
})

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search' })
const results = (page: Page) => page.locator('a.hit')

async function openSearch(page: Page) {
  await page.goto('/search')
  await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible()
}

test.describe('005-search: search screen', () => {
  test('AC-1: searching "költözés" shows every form of the word, highlighted', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'Annával a költözésről beszélgettünk.',
      entryDate: '2026-11-14',
      createdAt: '2026-11-14T16:15:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'A költözéshez még dobozok kellenek.',
      entryDate: '2026-11-23',
      createdAt: '2026-11-23T17:30:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'Semmi köze hozzá.',
      entryDate: '2026-11-24',
      createdAt: '2026-11-24T17:30:00Z',
    })
    await openSearch(page)
    await searchBox(page).fill('költözés')
    await expect(results(page)).toHaveCount(2)
    await expect(page.getByRole('status')).toHaveText('2 results')
    await expect(results(page).first().locator('mark')).toHaveText('költözéshez')
    await expect(results(page).first()).toContainText('Nov 23, 2026')
    await expect(results(page).first()).toContainText('text')
    await expectLayout(page, 'search')
  })

  test('AC-4: a word that is only spoken finds the entry with the transcript label', async ({
    page,
  }) => {
    await turnTranscriptionOn()
    await page.getByRole('link', { name: 'Upload an audio file' }).click()
    await page.locator('input[type="file"]').setInputFiles(clip)
    await page.getByRole('radio', { name: 'Automatic' }).check({ force: true })
    await page.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByTestId('transcript')).toHaveText(fakeTexts.hu, { timeout: 20_000 })

    await openSearch(page)
    await searchBox(page).fill('próbaszöveg')
    await expect(results(page)).toHaveCount(1)
    await expect(results(page).first().locator('.src')).toHaveText('transcript')
    await expect(results(page).first().locator('mark')).toHaveText('próbaszöveg')

    await searchBox(page).fill('probaszoveg')
    await expect(results(page)).toHaveCount(1)
  })

  test('AC-7: a word nobody wrote shows the empty state and one character sends nothing', async ({
    page,
  }) => {
    await seedTimelineEntry({
      bodyMd: 'A walk by the river',
      entryDate: '2026-11-25',
      createdAt: '2026-11-25T10:00:00Z',
    })
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/search')) requests.push(request.url())
    })
    await openSearch(page)
    await searchBox(page).fill('w')
    await page.waitForTimeout(600)
    expect(requests).toEqual([])
    await expect(results(page)).toHaveCount(0)

    await searchBox(page).fill('hajóút')
    await expect(page.getByText('No results')).toBeVisible()
    await expect(
      page.getByText("Try a shorter or different word. Accents don't matter."),
    ).toBeVisible()
    await expectLayout(page, 'searchempty')
  })

  test('AC-8: typing, clearing and opening a result', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'Sparrows on the fence',
      entryDate: '2026-11-25',
      createdAt: '2026-11-25T10:00:00Z',
    })
    await openSearch(page)
    await searchBox(page).fill('sparrow')
    await expect(results(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(searchBox(page)).toHaveValue('')
    await expect(results(page)).toHaveCount(0)

    await searchBox(page).fill('sparrow')
    await results(page).first().click()
    await expect(page.getByTestId('entry-body')).toContainText('Sparrows on the fence')
  })

  test('AC-6: markup in an entry shows as text in the snippet', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'Before <img src=x onerror="document.title=\'hacked\'"> the move',
      entryDate: '2026-11-25',
      createdAt: '2026-11-25T10:00:00Z',
    })
    await openSearch(page)
    await searchBox(page).fill('move')
    await expect(results(page)).toHaveCount(1)
    await expect(results(page).first()).toContainText('<img src=x')
    await expect(results(page).first().locator('img')).toHaveCount(0)
    expect(await page.title()).not.toBe('hacked')
  })
})
