/**
 * Resolution of the PostgreSQL database used by the automated test suites.
 *
 * Shared by `vitest.config.ts` and `playwright.config.ts` so the Vitest suite
 * (ephemeral `colosseum_test_*` schemas) and the Playwright suite (the `public`
 * schema) cannot drift onto different servers.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

export const DEFAULT_TEST_DATABASE_URL =
  'postgres://colosseum:colosseum@localhost:5432/colosseum_test';

/**
 * Only TEST_DATABASE_URL is read out of `.env`. Loading the whole file would
 * also pull in DATABASE_URL and make the suites talk to the developer's dev
 * database instead of colosseum_test.
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.TEST_DATABASE_URL) {
      return parsed.TEST_DATABASE_URL;
    }
  }

  return DEFAULT_TEST_DATABASE_URL;
}
