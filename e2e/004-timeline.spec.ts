import { expect, test, type Page } from '@playwright/test'
import {
  adminUsername,
  createAdmin,
  password,
  resetDatabase,
  seedBulkEntries,
  seedTimelineEntry,
  uniqueIp,
} from './support/server.ts'
import { expectLayout } from './support/layout.ts'

const evening = new Date('2026-11-26T20:30:00Z')

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context, page }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
  await page.clock.setFixedTime(evening)
})

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024

async function signIn(
  page: Page,
  labels = { username: 'Username', password: 'Password', go: 'Sign in' },
) {
  await page.goto('/login')
  await page.getByLabel(labels.username).fill(adminUsername)
  await page.getByLabel(labels.password).fill(password)
  await page.getByRole('button', { name: labels.go }).click()
  await expect(page.getByRole('heading', { name: /on your mind|fejedben/ })).toBeVisible()
}

const timelineList = (page: Page) => page.getByRole('region', { name: /Timeline|Idővonal/ })
const cards = (page: Page) => timelineList(page).getByRole('link')

const openTimeline = async (page: Page) => {
  await page.goto('/timeline')
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible()
}

test.describe('004-timeline: timeline and Home', () => {
  test.beforeEach(async ({ page }) => {
    await createAdmin(headers)
    await signIn(page)
  })

  test('AC-1: days are newest first and entries inside a day are newest first', async ({
    page,
  }) => {
    await seedTimelineEntry({
      bodyMd: 'early today',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T07:00:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'yesterday night',
      entryDate: '2026-11-25',
      createdAt: '2026-11-25T21:10:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'late today',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T19:42:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'backdated',
      entryDate: '2026-11-23',
      createdAt: '2026-11-26T20:00:00Z',
    })
    await openTimeline(page)
    await expect(cards(page)).toHaveCount(4)
    const texts = await cards(page).allTextContents()
    expect(
      texts.map((text) => /early today|yesterday night|late today|backdated/.exec(text)?.[0]),
    ).toEqual(['late today', 'early today', 'yesterday night', 'backdated'])
    await expectLayout(page, 'timeline')
  })

  test('AC-2: day headings in English name today, yesterday, then weekday and date', async ({
    page,
  }) => {
    for (const [day, hour] of [
      ['2026-11-26', 19],
      ['2026-11-25', 19],
      ['2026-11-23', 19],
      ['2025-12-05', 19],
    ] as const) {
      await seedTimelineEntry({
        bodyMd: `on ${day}`,
        entryDate: day,
        createdAt: `${day}T${String(hour)}:00:00Z`,
      })
    }
    await openTimeline(page)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Today, November 26',
      'Yesterday, November 25',
      'Monday, November 23',
      'Friday, December 5, 2025',
    ])
  })

  test('AC-3: cards show the icon, time, length and excerpt', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'Written **words**',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T11:05:00Z',
    })
    await seedTimelineEntry({
      bodyMd: '',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T19:42:00Z',
      recordings: [
        { status: 'done', durationMs: 108_000, transcript: 'Spoken words from the transcript' },
      ],
    })
    await seedTimelineEntry({
      bodyMd: '',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T09:00:00Z',
      recordings: [{ status: 'skipped', durationMs: 15_000 }],
    })
    await openTimeline(page)
    const voice = cards(page).filter({ hasText: 'Spoken words from the transcript' })
    await expect(voice).toContainText('Voice entry')
    await expect(voice).toContainText('8:42 PM · 1:48')
    const text = cards(page).filter({ hasText: 'Written words' })
    await expect(text).toContainText('Text entry')
    await expect(text).toContainText('12:05 PM')
    await expect(text).not.toContainText('·')
    await expect(cards(page).filter({ hasText: 'Recording, no text' })).toContainText('0:15')
  })

  test('AC-4: the badge shows the worst recording status', async ({ page }) => {
    const base = { bodyMd: '', entryDate: '2026-11-26' }
    await seedTimelineEntry({
      ...base,
      createdAt: '2026-11-26T10:00:00Z',
      recordings: [
        { status: 'done', durationMs: 1000, transcript: 'fine' },
        { status: 'failed', durationMs: 1000 },
      ],
    })
    await seedTimelineEntry({
      ...base,
      createdAt: '2026-11-26T11:00:00Z',
      recordings: [{ status: 'transcribing', durationMs: 1000 }],
    })
    await seedTimelineEntry({
      ...base,
      createdAt: '2026-11-26T12:00:00Z',
      recordings: [{ status: 'skipped', durationMs: 1000 }],
    })
    await seedTimelineEntry({
      ...base,
      createdAt: '2026-11-26T13:00:00Z',
      recordings: [{ status: 'done', durationMs: 1000, transcript: 'clean' }],
    })
    await openTimeline(page)
    await expect(cards(page).filter({ hasText: 'Failed' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Transcribing' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Not transcribed' })).toHaveCount(1)
    const clean = cards(page).filter({ hasText: 'clean' })
    await expect(clean).not.toContainText(/Failed|Transcribing|Not transcribed/)
  })

  test('AC-5: scrolling to the end loads the next 30 until all 75 show once each', async ({
    page,
  }) => {
    await seedBulkEntries(75, '2026-11-26T19:00:00Z')
    await page.route('**/api/v1/entries?*before=*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await openTimeline(page)
    await expect(cards(page)).toHaveCount(30)

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })
    await expect(page.getByText('Loading more entries…')).toBeVisible()
    await expect(cards(page)).toHaveCount(60)

    await expect(async () => {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight)
      })
      await expect(cards(page)).toHaveCount(75, { timeout: 1500 })
    }).toPass()
    const texts = await cards(page).allTextContents()
    expect(new Set(texts.map((text) => /Bulk entry \d+/.exec(text)?.[0])).size).toBe(75)
    await expect(page.getByText('Loading more entries…')).toBeHidden()
  })

  test('AC-6: a fresh account shows the empty timeline and the empty Today list', async ({
    page,
  }) => {
    await openTimeline(page)
    await expect(
      page.getByText('No entries yet. Record or write one on the Today page.'),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Today' }).first().click()
    await expect(page.getByText('No entries today yet.')).toBeVisible()
  })

  test('AC-7: opening a card shows the entry, and Back returns to the same scroll position', async ({
    page,
  }) => {
    test.skip(isWide(page), 'the phone layout')
    await seedBulkEntries(75, '2026-11-26T19:00:00Z')
    await openTimeline(page)
    await expect(cards(page)).toHaveCount(30)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })
    await expect(cards(page)).toHaveCount(60)
    const target = cards(page).nth(45)
    await target.scrollIntoViewIfNeeded()
    const before = await page.evaluate(() => window.scrollY)
    expect(before).toBeGreaterThan(1000)
    const label = (await target.textContent()) ?? ''
    await target.click()
    await expect(page.getByTestId('entry-body')).toContainText(/Bulk entry \d+/)
    expect(label).toContain(await page.getByTestId('entry-body').innerText())
    await page.getByRole('link', { name: 'Back' }).click()
    await expect(cards(page)).toHaveCount(60)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 5)
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(5)
  })

  test('AC-7: on a wide screen the entry opens beside the list with its card marked current', async ({
    page,
  }) => {
    test.skip(!isWide(page), 'the desktop layout')
    await seedTimelineEntry({
      bodyMd: 'first words',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T08:00:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'second words',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T09:00:00Z',
    })
    await openTimeline(page)
    await cards(page).filter({ hasText: 'first words' }).click()
    await expect(page.getByTestId('entry-body')).toHaveText('first words')
    await expect(cards(page)).toHaveCount(2)
    await expect(cards(page).filter({ hasText: 'first words' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(cards(page).filter({ hasText: 'second words' })).not.toHaveAttribute(
      'aria-current',
    )

    await cards(page).filter({ hasText: 'second words' }).click()
    await expect(page.getByTestId('entry-body')).toHaveText('second words')
    await expect(cards(page).filter({ hasText: 'second words' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expectLayout(page, 'split view')
  })

  test('AC-7: deleting an entry from its page opens Home and the timeline no longer has it', async ({
    page,
  }) => {
    await seedTimelineEntry({
      bodyMd: 'to be deleted',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T08:00:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'to be kept',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T09:00:00Z',
    })
    await openTimeline(page)
    await cards(page).filter({ hasText: 'to be deleted' }).click()
    await expect(page.getByTestId('entry-body')).toHaveText('to be deleted')
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(/\/$/)
    await openTimeline(page)
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page)).toContainText('to be kept')
  })

  test('AC-8: Home greets by the time of day and lists only the entries of today', async ({
    page,
  }) => {
    await seedTimelineEntry({
      bodyMd: 'yesterday entry',
      entryDate: '2026-11-25',
      createdAt: '2026-11-25T19:00:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'morning entry',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T06:00:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'evening entry',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T19:00:00Z',
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Good evening, Örs. What's on your mind?",
    )
    const today = page.getByRole('region', { name: "Today's entries" })
    await expect(today.getByRole('link')).toHaveCount(2)
    await expect(today.getByRole('link').first()).toContainText('evening entry')
    await expect(today.getByRole('link').nth(1)).toContainText('morning entry')
    await expect(page.getByRole('link', { name: 'Start recording' })).toBeVisible()
    await expect(page.getByRole('button', { name: "I'd rather write" })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Upload an audio file' })).toBeVisible()
    await expect(
      page.getByText(isWide(page) ? 'Thursday, November 26' : 'Thursday', { exact: true }),
    ).toBeVisible()
    await expectLayout(page, 'Home')
  })

  test('AC-8: the greeting and the day follow the clock in the user time zone', async ({
    page,
  }) => {
    await seedTimelineEntry({
      bodyMd: 'after midnight',
      entryDate: '2026-11-27',
      createdAt: '2026-11-26T23:30:00Z',
    })
    await seedTimelineEntry({
      bodyMd: 'before midnight',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T20:00:00Z',
    })
    await page.clock.setFixedTime(new Date('2026-11-26T23:45:00Z'))
    await page.goto('/')
    await expect(
      page.getByRole('region', { name: "Today's entries" }).getByRole('link'),
    ).toHaveCount(1)
    await expect(page.getByRole('region', { name: "Today's entries" })).toContainText(
      'after midnight',
    )

    await page.clock.setFixedTime(new Date('2026-11-27T04:00:00Z'))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Good morning, Örs. What's on your mind?",
    )
    await page.clock.setFixedTime(new Date('2026-11-27T09:00:00Z'))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Good afternoon, Örs. What's on your mind?",
    )
  })

  test('AC-9: the tab bar on a phone and the sidebar on a desktop', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'some words',
      entryDate: '2026-11-26',
      createdAt: '2026-11-26T08:00:00Z',
    })
    await page.goto('/')
    const bar = isWide(page) ? page.locator('nav.side') : page.locator('nav.tabs')
    await expect(bar.getByRole('link')).toHaveText(['Today', 'Timeline', 'Search', 'Settings'])
    await expect(bar.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
    if (isWide(page)) {
      await expect(page.locator('nav.tabs')).toBeHidden()
      await expect(bar.getByText('Your voice stays on your own server.')).toHaveCount(0)
      await expect(bar.getByRole('link', { name: 'New recording' })).toHaveCount(0)
    } else {
      await expect(page.locator('nav.side')).toBeHidden()
    }

    await bar.getByRole('link', { name: 'Timeline' }).click()
    await expect(bar.getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    if (isWide(page)) await expect(bar.getByRole('link', { name: 'New recording' })).toBeVisible()

    await cards(page).first().click()
    await expect(page.getByTestId('entry-body')).toBeVisible()
    if (isWide(page))
      await expect(bar.getByRole('link', { name: 'Timeline' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    else await expect(page.locator('nav.tabs')).toHaveCount(0)

    await page.goto('/write')
    await expect(page.getByRole('heading', { name: 'New entry' })).toBeVisible()
    await expect(page.locator('nav.tabs')).toHaveCount(0)
  })

  test('AC-10: switching the time zone moves the time and keeps the day', async ({ page }) => {
    await seedTimelineEntry({
      bodyMd: 'after midnight',
      entryDate: '2026-11-27',
      createdAt: '2026-11-26T23:30:00Z',
    })
    await page.clock.setFixedTime(new Date('2026-11-27T10:00:00Z'))
    await openTimeline(page)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Today, November 27')
    await expect(cards(page)).toContainText('12:30 AM')

    await page.goto('/settings')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/me/settings')),
      page.getByLabel('Time zone').selectOption('Atlantic/Reykjavik'),
    ])
    await openTimeline(page)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Today, November 27')
    await expect(cards(page)).toContainText('11:30 PM')
  })
})

test.describe('004-timeline: Hungarian', () => {
  test.use({ locale: 'hu-HU' })

  test('AC-2: day headings in Hungarian', async ({ page }) => {
    await createAdmin(headers, 'hu')
    await signIn(page, { username: 'Felhasználónév', password: 'Jelszó', go: 'Belépés' })
    for (const day of ['2026-11-26', '2026-11-25', '2026-11-23', '2025-12-05']) {
      await seedTimelineEntry({
        bodyMd: `on ${day}`,
        entryDate: day,
        createdAt: `${day}T19:00:00Z`,
      })
    }
    await page.goto('/timeline')
    await expect(page.getByRole('heading', { name: 'Idővonal', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Ma, november 26.',
      'Tegnap, november 25.',
      'Hétfő, november 23.',
      'Péntek, 2025. december 5.',
    ])
    await page.getByRole('link', { name: 'Ma' }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Jó estét, Örs! Mi járt a fejedben?',
    )
    await expect(page.getByText('Mai bejegyzések', { exact: true })).toBeVisible()
  })
})
