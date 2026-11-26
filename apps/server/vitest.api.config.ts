import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'api', include: ['test/**/*.test.ts'], hookTimeout: 120_000, testTimeout: 60_000 },
})
