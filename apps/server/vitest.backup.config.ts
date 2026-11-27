import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'backup-restore',
    include: ['test/backup-restore/**/*.test.ts'],
    hookTimeout: 600_000,
    testTimeout: 600_000,
  },
})
