import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'shared',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['**/*.test.ts', '**/main.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
})
