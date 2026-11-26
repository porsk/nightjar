import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // main.ts, start.ts and database.ts need a real Postgres and are covered by the API tests
      exclude: [
        '**/*.test.ts',
        '**/main.ts',
        '**/start.ts',
        '**/database.ts',
        'src/db/**',
        'src/modules/auth/auth.ts',
        'src/modules/auth/routes.ts',
        'src/modules/auth/setup-code.ts',
        'src/modules/settings/routes.ts',
        'src/modules/entries/routes.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
})
