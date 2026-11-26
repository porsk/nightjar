import type { ManifestOptions } from 'vite-plugin-pwa'

const themeColor = '#14122b'

export const manifest = {
  name: 'Nightjar',
  short_name: 'Nightjar',
  display: 'standalone',
  start_url: '/',
  scope: '/',
  theme_color: themeColor,
  background_color: themeColor,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} satisfies Partial<ManifestOptions>
