import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest.ts'

const publicDir = join(import.meta.dirname, '../public')

describe('006-settings: web app manifest', () => {
  it('AC-14: has the name, standalone display, start URL and the design token colours', () => {
    expect(manifest).toMatchObject({
      name: 'Nightjar',
      display: 'standalone',
      start_url: '/',
      theme_color: '#14122b',
      background_color: '#14122b',
    })
  })

  it('AC-14: lists 192, 512 and maskable PNG icons that exist', () => {
    const find = (sizes: string, purpose: string) =>
      manifest.icons.find((icon) => icon.sizes === sizes && icon.purpose === purpose)
    expect(find('192x192', 'any')).toBeDefined()
    expect(find('512x512', 'any')).toBeDefined()
    expect(find('512x512', 'maskable')).toBeDefined()
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(existsSync(join(publicDir, icon.src)), icon.src).toBe(true)
    }
  })
})
