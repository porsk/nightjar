import { expect, test } from '@playwright/test'
import { expectLayout } from './support/layout.ts'

test.use({ viewport: { width: 390, height: 600 } })
test.skip(({ browserName }) => browserName !== 'chromium', 'mobile emulation widens the viewport')

test.describe('layout helper', () => {
  test('passes on a tidy page and ignores hidden and decorative elements', async ({ page }) => {
    await page.setContent(`
      <button>One</button> <a href="#">Two</a>
      <div aria-hidden="true" style="position:absolute;left:300px;width:400px;height:20px"></div>
      <button style="display:none;position:absolute;left:0;top:0">Hidden</button>
      <div style="overflow-x:auto;width:200px"><div style="width:600px">wide table</div></div>`)
    await expectLayout(page, 'tidy page')
  })

  test('fails on sideways scroll, clipped content and overlapping controls', async ({ page }) => {
    await page.setContent(`
      <div style="width:600px">too wide</div>
      <button style="position:absolute;left:0;top:300px;width:100px;height:40px">A</button>
      <button style="position:absolute;left:50px;top:310px;width:100px;height:40px">B</button>`)
    await expect(expectLayout(page, 'broken page')).rejects.toThrow(
      /scrolls sideways[\s\S]*outside the viewport[\s\S]*overlapping controls/,
    )
  })
})
