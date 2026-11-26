import { expect, test } from '@playwright/test'

test.describe('006-settings: installable app', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'service worker checks run in Chromium',
  )

  test('AC-14: the manifest, its icons and a service worker are there', async ({
    page,
    request,
  }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')

    const response = await request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)
    const manifest = (await response.json()) as {
      name: string
      display: string
      start_url: string
      theme_color: string
      background_color: string
      icons: { src: string; sizes: string; type: string; purpose?: string }[]
    }
    expect(manifest).toMatchObject({
      name: 'Nightjar',
      display: 'standalone',
      start_url: '/',
      theme_color: '#14122b',
      background_color: '#14122b',
    })
    const sizes = manifest.icons.map(({ sizes: size, purpose }) => `${size} ${purpose ?? 'any'}`)
    expect(sizes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    )
    for (const icon of manifest.icons) {
      const file = await request.get(icon.src)
      expect(file.status(), icon.src).toBe(200)
      expect(file.headers()['content-type'], icon.src).toContain('image/png')
    }

    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return registration.active?.state
    })
    expect(registered).toBeTruthy()
  })

  test('AC-15: the app shell loads offline and the cache never holds API or audio responses', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true)
    await page.reload()
    await expect(page.locator('#root')).not.toBeEmpty()

    await context.setOffline(true)
    await page.reload()
    await expect(page).toHaveTitle('Nightjar')
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByRole('alert')).toHaveText('Something went wrong. Try again.')
    await context.setOffline(false)

    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const entry of await cache.keys()) urls.push(new URL(entry.url).pathname)
      }
      return urls
    })
    expect(cached.length).toBeGreaterThan(0)
    expect(cached.some((url) => url.endsWith('.js'))).toBe(true)
    for (const url of cached) {
      expect(url).not.toMatch(/^\/api\//)
      expect(url).not.toMatch(/\.(webm|ogg|m4a|mp4|aac|mp3|wav|flac)$/)
    }
  })
})
