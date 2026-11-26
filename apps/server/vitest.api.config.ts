import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/start.ts', 'src/database.ts'],
      reportsDirectory: 'coverage-api',
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
})
