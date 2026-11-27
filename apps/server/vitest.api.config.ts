import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    exclude: ['test/nightly/**', 'test/backup-restore/**', '**/node_modules/**'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/start.ts',
        'src/database.ts',
        'src/modules/auth/*.ts',
        'src/modules/settings/*.ts',
        'src/modules/entries/*.ts',
        'src/modules/events/*.ts',
        'src/modules/recordings/*.ts',
        'src/modules/search/*.ts',
        'src/modules/transcription/*.ts',
        'src/events.ts',
        'src/jobs.ts',
        'src/worker.ts',
        'src/audio/ffmpeg.ts',
      ],
      exclude: [
        '**/*.test.ts',
        'src/modules/transcription/sherpa-transcriber.ts',
        'src/modules/transcription/sherpa-child.ts',
      ],
      reportsDirectory: 'coverage-api',
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
})
