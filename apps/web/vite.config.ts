import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { manifest } from './src/manifest.ts'

const target = {
  target: `http://localhost:${process.env['NIGHTJAR_API_PORT'] ?? '3000'}`,
  changeOrigin: false,
}
const proxy = { '/healthz': target, '/api': target }

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz/, /^\/readyz/, /^\/metrics/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: { proxy },
  preview: { proxy },
})
