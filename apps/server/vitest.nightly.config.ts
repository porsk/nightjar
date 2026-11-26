import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'nightly',
    include: ['test/nightly/**/*.test.ts'],
    hookTimeout: 1_800_000,
    testTimeout: 300_000,
  },
})
