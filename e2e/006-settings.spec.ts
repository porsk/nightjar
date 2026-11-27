import { expect, test, type Locator, type Page } from '@playwright/test'
import { en } from '../apps/web/src/i18n/en.ts'
import { hu } from '../apps/web/src/i18n/hu.ts'
import { expectLayout } from './support/layout.ts'
import { adminUsername, createAdmin, password, resetDatabase, uniqueIp } from './support/server.ts'
import { catalogue, walkScreens, type Language } from './support/walk.ts'

// Mocked responses (route) never reach a page whose service worker handles its requests
test.use({ serviceWorkers: 'block' })

let headers: Record<string, string>

test.beforeEach(async ({ context }) => {
  await resetDatabase()
  headers = { 'x-forwarded-for': uniqueIp() }
  await context.setExtraHTTPHeaders(headers)
})

const uiLanguageGroup = (page: Page) =>
  page.getByRole('radiogroup', { name: /App language|A felület nyelve/ })
const entryLanguageGroup = (page: Page) =>
  page.getByRole('radiogroup', { name: /Default language for recordings|Alapértelmezett nyelv/ })
const choose = (group: Locator, name: string) =>
  group.getByRole('radio', { name }).click({ force: true })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /Felhasználónév|Username/i }).fill(adminUsername)
  await page.locator('#password').fill(password)
  await page.locator('button[type=submit]').click()
  await expect(page).toHaveURL(/\/$/)
}

async function openSettings(page: Page) {
  await createAdmin(headers)
  await signIn(page)
  await page.getByRole('link', { name: 'Settings' }).first().click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

const leaves = (tree: object) => {
  const found = new Map<string, string>()
  const walk = (node: object, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'object' && value !== null) walk(value as object, `${prefix}${key}.`)
      else found.set(`${prefix}${key}`, String(value))
    }
  }
  walk(tree, '')
  return found
}

/** Texts of the other language that differ from this language's text for the same key. */
function foreignTexts(current: Language) {
  const own = leaves(catalogue[current])
  const other = leaves(catalogue[current === 'en' ? 'hu' : 'en'])
  return new Map(
    [...other]
      .filter(([key, text]) => text !== own.get(key) && !text.includes('{{'))
      .map(([key, text]) => [text, key]),
  )
}

async function expectOnly(page: Page, language: Language, state: string) {
  const collectTexts = () =>
    page.evaluate(() => {
      const found: string[] = []
      for (const element of document.querySelectorAll('body *')) {
        const own = element.children.length === 0 ? element.textContent.trim() : ''
        if (own) found.push(own)
        const label = element.getAttribute('aria-label')
        if (label) found.push(label)
      }
      return found
    })
  await expect
    .poll(async () => (await collectTexts()).length, { message: `${state} has text` })
    .toBeGreaterThan(0)
  const texts = await collectTexts()
  const foreign = foreignTexts(language)
  for (const text of texts) {
    expect(foreign.get(text), `${state}: "${text}" belongs to the other language`).toBeUndefined()
  }
}

test.describe('006-settings: language, time zone and account', () => {
  test('AC-1: switching the app language changes the whole UI, survives a reload and another browser', async ({
    page,
    browser,
  }) => {
    await openSettings(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await choose(uiLanguageGroup(page), 'Magyar')
    await expect(page.getByRole('heading', { name: 'Beállítások' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'hu')
    await expect(page.getByRole('link', { name: 'Ma' }).first()).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Beállítások' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'hu')

    const other = await browser.newContext({ extraHTTPHeaders: headers, locale: 'en-US' })
    const otherPage = await other.newPage()
    await signIn(otherPage)
    await expect(otherPage.getByRole('heading', { name: /Mi járt a fejedben/ })).toBeVisible()
    await other.close()

    await choose(uiLanguageGroup(page), 'English')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('AC-2: the default recording language is saved and survives a reload', async ({ page }) => {
    await openSettings(page)
    const radio = (name: string) => entryLanguageGroup(page).getByRole('radio', { name })
    await expect(radio('English')).toBeChecked()
    await choose(entryLanguageGroup(page), 'Automatic')
    await expect(radio('Automatic')).toBeChecked()
    await page.reload()
    await expect(radio('Automatic')).toBeChecked()
    await choose(entryLanguageGroup(page), 'Magyar')
    await page.reload()
    await expect(radio('Magyar')).toBeChecked()
    await expect(page.getByText('You can change it per entry.')).toBeVisible()
  })

  test('AC-3: the time zone is chosen from the listed IANA zones and saved', async ({ page }) => {
    await openSettings(page)
    const select = page.getByLabel('Time zone')
    await expect(select).toHaveValue('Europe/Budapest')
    const options = await select.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(300)
    expect(options).toContainEqual(expect.stringMatching(/^Asia\/Tokyo \(UTC\+09:00\)$/))

    await select.selectOption('Asia/Tokyo')
    await page.reload()
    await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Tokyo')
  })

  test('AC-4: a settings change that fails goes back to the saved value and shows an error', async ({
    page,
  }) => {
    await openSettings(page)
    await page.route('**/api/v1/me/settings', (route) =>
      route.fulfill({ status: 500, json: { error: { code: 'internal_error', message: 'x' } } }),
    )
    await choose(entryLanguageGroup(page), 'Automatic')
    await expect(page.getByRole('alert')).toHaveText("Couldn't save the setting.")
    const radio = (name: string) => entryLanguageGroup(page).getByRole('radio', { name })
    await expect(radio('English')).toBeChecked()
    await expect(radio('Automatic')).not.toBeChecked()
  })

  test('AC-16: a new name saved in Account shows in the Home greeting after a reload', async ({
    page,
  }) => {
    await openSettings(page)
    const name = page.getByLabel('What should we call you?')
    await expect(name).toHaveValue('Örs')
    await name.fill('Árpád')
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/v1/me/settings')),
      name.press('Enter'),
    ])
    await page.reload()
    await expect(name).toHaveValue('Árpád')
    await page.getByRole('link', { name: 'Today' }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Árpád')
  })

  test('AC-11: settings can only be read or changed with a session', async ({ page, request }) => {
    await openSettings(page)
    const change = await request.patch('/api/v1/me/settings', {
      headers,
      data: { timeZone: 'Asia/Tokyo' },
    })
    expect(change.status()).toBe(401)
    expect((await request.get('/api/v1/me', { headers })).status()).toBe(401)
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Budapest')
  })
})

for (const language of ['en', 'hu'] as const) {
  test.describe(`006-settings: every screen in ${language}`, () => {
    test.use({ locale: language === 'hu' ? 'hu-HU' : 'en-US' })

    test(`AC-6: no text from the other language on any screen state in ${language}`, async ({
      page,
    }) => {
      await walkScreens(page, language, headers, (state) => expectOnly(page, language, state))
    })
  })
}

for (const width of [390, 1280]) {
  test.describe(`006-settings: Hungarian at ${String(width)} px`, () => {
    test.use({ locale: 'hu-HU', viewport: { width, height: 844 } })

    test(`AC-10: no screen state has layout problems at ${String(width)} px`, async ({ page }) => {
      await walkScreens(page, 'hu', headers, (state) => expectLayout(page, state))
    })
  })
}

test.describe('006-settings: before sign-in the browser language decides', () => {
  for (const locale of ['hu-HU', 'en-US']) {
    test.describe(locale, () => {
      test.use({ locale })

      test(`AC-8: setup step 1 is English and login follows the browser (${locale})`, async ({
        page,
      }) => {
        await page.goto('/setup')
        await expect(page.getByRole('heading', { name: en.setup.account.title })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')

        await createAdmin(headers)
        await page.goto('/login')
        const hungarian = locale === 'hu-HU'
        const expected = hungarian ? hu.login.title : en.login.title
        await expect(page.getByRole('heading', { name: expected })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', hungarian ? 'hu' : 'en')
      })
    })
  }
})

test.describe('006-settings: theme follows the system', () => {
  const background = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  test('AC-9: dark and light system settings use their own tokens, and there is no theme setting', async ({
    page,
  }) => {
    await openSettings(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await background(page)).toBe('rgb(20, 18, 43)')
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await background(page)).toBe('rgb(247, 242, 251)')
    await expect(page.getByText(/theme|téma|dark mode|sötét/i)).toHaveCount(0)
    await expect(page.getByRole('radiogroup')).toHaveCount(2)
  })
})
