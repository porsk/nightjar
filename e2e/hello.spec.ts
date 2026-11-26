import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.describe('hello page', () => {
  test('shows the greeting and that the server is up', async ({ page }, testInfo) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('The server is up.')).toBeVisible()
    await testInfo.attach('hello', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
