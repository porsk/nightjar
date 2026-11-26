import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

// Renders the web app icons from the approved logo: node scripts/make-icons.ts
const root = path.join(import.meta.dirname, '..')
const logoFile = path.join(root, 'design/logo/nightjar.svg')
const outDir = path.join(root, 'apps/web/public')
const logo = readFileSync(logoFile, 'utf8')

const square = logo.replace('rx="14"', 'rx="0"')
const maskable = square.replace('scale(2.7)', 'scale(2.2)')

const icons = [
  { file: 'icon-192.png', size: 192, svg: logo },
  { file: 'icon-512.png', size: 512, svg: logo },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
  { file: 'apple-touch-icon.png', size: 180, svg: square },
]

mkdirSync(outDir, { recursive: true })
copyFileSync(logoFile, path.join(outDir, 'favicon.svg'))

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const { file, size, svg } of icons) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`,
    )
    await page.screenshot({ path: path.join(outDir, file), omitBackground: true })
  }
} finally {
  await browser.close()
}
