import { defineConfig, devices } from '@playwright/test';
import { resolveTestDatabaseUrl } from './config/testDatabaseUrl';
import { E2E_SESSION_SECRET } from './e2e/helpers/session';

/**
 * The suite runs its own Express and Vite on dedicated ports against the test
 * database, so it can run while `npm run dev` serves the dev database on
 * 3000/5173. Reusing a server on those ports would seed and truncate the
 * developer's tournament data.
 */
const API_PORT = 3001;
const CLIENT_PORT = 5174;
const API_URL = `http://localhost:${API_PORT}`;
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Specs share colosseum_test.public, one Vite transform pipeline, and one
  // Express process. Parallel workers race on rows, lazy-route compiles, and
  // production rate limiters — which shows up as a different spec failing
  // each run. Isolation is file-serial on a single worker, matching CI.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  globalSetup: './e2e/globalSetup.ts',
  expect: {
    // Vite compiles React.lazy routes on first navigation; 5s is tight.
    timeout: 10_000,
  },
  use: {
    baseURL: CLIENT_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Plain ts-node, not `npm run dev:server` (nodemon). A spurious restart
      // mid-suite blanks the page and fails whichever spec is in flight.
      command: 'npx ts-node src/server/server.ts',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: resolveTestDatabaseUrl(),
        CLIENT_URL,
        SESSION_SECRET: E2E_SESSION_SECRET,
        COLOSSEUM_DISABLE_RATE_LIMIT: '1',
        // pg parses DATE columns into a Date at local midnight, so serialized
        // date-only values depend on the server's timezone.
        TZ: 'UTC',
      },
    },
    {
      command: `npx vite --host 0.0.0.0 --port ${CLIENT_PORT}`,
      url: CLIENT_URL,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        COLOSSEUM_API_URL: API_URL,
      },
    },
  ],
});
