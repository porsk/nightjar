import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return String(port)
}

// Workers load this file again, so values chosen by the main process are kept from the environment.
const e2eDir = (process.env['NIGHTJAR_E2E_DIR'] ??= mkdtempSync(
  path.join(tmpdir(), 'nightjar-e2e-'),
))
process.env['NIGHTJAR_E2E_SERVER_PORT'] ??= await freePort()
process.env['NIGHTJAR_E2E_WEB_PORT'] ??= await freePort()
process.env['NIGHTJAR_E2E_METRICS_PORT'] ??= await freePort()
const serverPort = process.env['NIGHTJAR_E2E_SERVER_PORT']
const webPort = process.env['NIGHTJAR_E2E_WEB_PORT']
const metricsPort = process.env['NIGHTJAR_E2E_METRICS_PORT']

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  use: {
    baseURL: `http://localhost:${webPort}`,
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
      url: `http://localhost:${serverPort}/readyz`,
      env: {
        PORT: serverPort,
        NIGHTJAR_METRICS_PORT: metricsPort,
        NIGHTJAR_DATA_DIR: path.join(e2eDir, 'data'),
        NIGHTJAR_WEB_DIR: path.join(import.meta.dirname, 'apps/web/dist'),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @nightjar/web build && pnpm --filter @nightjar/web exec vite preview --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      env: { NIGHTJAR_API_PORT: serverPort },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
