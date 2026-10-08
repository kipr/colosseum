import { defineConfig, devices } from '@playwright/test';

// These regressions mock API responses and only need Vite, not PostgreSQL.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'modal-shell.spec.ts',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
