import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 15'] }, testIgnore: /fake-mic/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @nightjar/server exec node test/support/e2e-server.ts',
      url: 'http://localhost:3000/readyz',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'pnpm --filter @nightjar/web build && pnpm --filter @nightjar/web exec vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
