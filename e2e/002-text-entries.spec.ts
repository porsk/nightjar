import { expect, test, type Page } from '@playwright/test'
import {
  adminUsername,
  countRecordings,
  createAdmin,
  fileExists,
  password,
  readEntries,
  resetDatabase,
  seedEntry,
  uniqueIp,
} from './support/server.ts'

const evening = new Date('2026-11-26T20:30:00Z')

test.use({ timezoneId: 'Europe/Budapest', serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context, page }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
  await page.clock.setFixedTime(evening)
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(adminUsername)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

test.describe('002-text-entries: write, edit, date and delete', () => {
  test.beforeEach(async ({ page }) => {
    await createAdmin(headers)
    await signIn(page)
  })

  test('AC-1: "I\'d rather write" opens the writer with today in the date chip', async ({
    page,
  }) => {
    await page.getByRole('button', { name: "I'd rather write" }).click()
    await expect(page.getByRole('heading', { name: 'New entry' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Today, November 26' })).toBeVisible()
  })

  test('AC-2: typed text is saved on its own and is still there after a reload', async ({
    page,
  }) => {
    await page.goto('/write')
    await page.getByLabel('Entry text').fill('First words of the day')
    await expect(page.getByText('Saved 21:30')).toBeVisible()
    await page.getByLabel('Entry text').pressSequentially(' and some more')
    await expect(page.getByText('Saved 21:30')).toBeVisible()
    await expect
      .poll(async () => (await readEntries()).at(0)?.body_md)
      .toBe('First words of the day and some more')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Edit entry' })).toBeVisible()
    await expect(page.getByLabel('Entry text')).toHaveValue('First words of the day and some more')
    expect(await readEntries()).toHaveLength(1)
  })

  test('AC-2: nothing is created while the text is empty', async ({ page }) => {
    await page.goto('/write')
    await page.getByLabel('Entry text').fill('x')
    await page.getByLabel('Entry text').fill('')
    await page.waitForTimeout(1500)
    expect(await readEntries()).toHaveLength(0)
  })

  test('AC-3: Done saves what was just typed and shows it on the entry page', async ({ page }) => {
    await page.goto('/write')
    await page.getByLabel('Entry text').fill('Typed and straight to Done')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('entry-body')).toHaveText('Typed and straight to Done')
    await expect(page.getByRole('button', { name: 'Change date' })).toBeVisible()
  })

  test('AC-4: Markdown shows formatted and raw HTML shows as text', async ({ page }) => {
    const { entryId } = await seedEntry({
      bodyMd:
        '**bold** words\n\n- one\n- two\n\n[site](https://example.test)\n\n<img src=x onerror="document.title=\'pwned\'">',
      entryDate: '2026-11-26',
    })
    await page.goto(`/entries/${entryId}`)
    const body = page.getByTestId('entry-body')
    await expect(body.locator('strong')).toHaveText('bold')
    await expect(body.locator('li')).toHaveCount(2)
    await expect(body.getByRole('link', { name: 'site' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
    await expect(body).toContainText('<img src=x onerror="document.title=\'pwned\'">')
    await expect(body.locator('img')).toHaveCount(0)
    expect(await page.title()).not.toBe('pwned')
  })

  test('AC-5: changing the date on the entry page is saved, future days cannot be picked, Cancel keeps it', async ({
    page,
  }) => {
    const { entryId } = await seedEntry({ bodyMd: 'about another day', entryDate: '2026-11-26' })
    await page.goto(`/entries/${entryId}`)

    await page.getByRole('button', { name: 'Change date' }).click()
    await expect(page.getByRole('button', { name: '27', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '20', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Thursday, November 26, 2026' })).toBeVisible()
    expect((await readEntries())[0]?.entry_date).toBe('2026-11-26')

    await page.getByRole('button', { name: 'Change date' }).click()
    await page.getByRole('button', { name: '20', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('heading', { name: 'Friday, November 20, 2026' })).toBeVisible()
    await expect.poll(async () => (await readEntries())[0]?.entry_date).toBe('2026-11-20')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Friday, November 20, 2026' })).toBeVisible()
  })

  test('AC-5: the date chip of the writer picks the day of a new entry', async ({ page }) => {
    await page.goto('/write')
    await page.getByRole('button', { name: 'Today, November 26' }).click()
    await page.getByRole('button', { name: '24', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Tuesday, November 24, 2026' })).toBeVisible()
    await page.getByLabel('Entry text').fill('about tuesday')
    await expect.poll(async () => (await readEntries())[0]?.entry_date).toBe('2026-11-24')
  })

  test('AC-8: edit opens the writer with the text, and changes survive a reload', async ({
    page,
  }) => {
    const { entryId } = await seedEntry({ bodyMd: 'original text', entryDate: '2026-11-25' })
    await page.goto(`/entries/${entryId}`)
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page.getByRole('heading', { name: 'Edit entry' })).toBeVisible()
    await expect(page.getByLabel('Entry text')).toHaveValue('original text')
    await expect(page.getByRole('button', { name: 'Yesterday, November 25' })).toBeVisible()
    await page.getByLabel('Entry text').fill('changed text')
    await expect(page.getByText('Saved 21:30')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Entry text')).toHaveValue('changed text')
  })

  test('AC-9: deleting from the entry page removes the entry, its recordings and files', async ({
    page,
  }) => {
    const { entryId, keys } = await seedEntry({
      bodyMd: 'bye',
      entryDate: '2026-11-25',
      recordingNames: ['one', 'two'],
    })
    for (const key of keys) expect(fileExists(key)).toBe(true)
    await page.goto(`/entries/${entryId}`)
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('entry-body')).toHaveText('bye')

    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(new RegExp('/$'))
    expect(await readEntries()).toHaveLength(0)
    expect(await countRecordings()).toBe(0)
    for (const key of keys) expect(fileExists(key)).toBe(false)
  })

  test('AC-9: deleting from the edit screen works too', async ({ page }) => {
    const { entryId, keys } = await seedEntry({
      bodyMd: 'bye from the editor',
      entryDate: '2026-11-25',
      recordingNames: ['three'],
    })
    await page.goto(`/entries/${entryId}/edit`)
    await page.getByRole('button', { name: 'Delete entry' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page).toHaveURL(new RegExp('/$'))
    expect(await readEntries()).toHaveLength(0)
    for (const key of keys) expect(fileExists(key)).toBe(false)
  })

  test('AC-10: a failed save shows the message, keeps the text and recovers on retry', async ({
    page,
  }) => {
    await page.route('**/api/v1/entries', (route) => route.abort('failed'))
    await page.goto('/write')
    await page.getByLabel('Entry text').fill('worth keeping')
    await expect(page.getByText("Couldn't save.")).toBeVisible()
    await expect(page.getByLabel('Entry text')).toHaveValue('worth keeping')

    await page.unroute('**/api/v1/entries')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Saved 21:30')).toBeVisible()
    await expect(page.getByText("Couldn't save.")).toHaveCount(0)
    expect((await readEntries())[0]?.body_md).toBe('worth keeping')
  })

  test('AC-11: another entry id shows "Entry not found."', async ({ page }) => {
    await page.goto('/entries/6f1c5c0e-7f0c-4a53-8f3a-0d6c1f0a9b11')
    await expect(page.getByText('Entry not found.')).toBeVisible()
  })

  test('AC-4: a Markdown image from another site is never requested, and the page still works', async ({
    page,
  }) => {
    const { entryId } = await seedEntry({
      bodyMd: 'before ![tracker](https://images.example.test/pixel.png) after',
      entryDate: '2026-11-26',
    })
    const requested: string[] = []
    page.on('response', (response) => requested.push(response.url()))
    const violations: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text())
    })

    await page.goto(
      `http://localhost:${process.env['NIGHTJAR_E2E_SERVER_PORT'] ?? ''}/entries/${entryId}`,
    )
    await expect(page.getByTestId('entry-body')).toContainText('before')
    await page.getByRole('button', { name: 'Change date' }).click()
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible()
    await page.waitForTimeout(500)

    expect(requested.some((url) => url.includes('images.example.test'))).toBe(false)
    expect(violations.some((text) => text.includes('images.example.test'))).toBe(true)
    expect(violations.filter((text) => !text.includes('images.example.test'))).toEqual([])
  })
})

test.describe('002-text-entries: in Hungarian', () => {
  test.use({ locale: 'hu-HU' })

  test('AC-1: "Inkább írok" opens "Új bejegyzés" with "Ma, november 26."', async ({ page }) => {
    await createAdmin(headers, 'hu')
    await page.goto('/login')
    await page.getByLabel('Felhasználónév').fill(adminUsername)
    await page.getByLabel('Jelszó').fill(password)
    await page.getByRole('button', { name: 'Belépés' }).click()
    await page.getByRole('button', { name: 'Inkább írok' }).click()
    await expect(page.getByRole('heading', { name: 'Új bejegyzés' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ma, november 26.' })).toBeVisible()
    await page.getByLabel('A bejegyzés szövege').fill('Magyar szöveg')
    await expect(page.getByText('Mentve 21:30')).toBeVisible()
    await expect(page.getByText('Markdown használható')).toBeVisible()
  })
})
