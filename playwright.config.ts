import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 3,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.MADORI_WEB_URL ?? 'http://127.0.0.1:5173',
    launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE },
  },
  webServer: process.env.MADORI_WEB_URL ? undefined : {
    command: 'bun --bun run dev --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: true,
  },
})
