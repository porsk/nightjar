import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/main.tsx', '**/test-setup.ts', '**/test-utils.tsx'],
      reporter: ['text', 'html'],
      thresholds: { lines: 80 },
    },
  },
})
