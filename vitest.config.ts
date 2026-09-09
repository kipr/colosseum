import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const DEFAULT_TEST_DATABASE_URL =
  'postgres://colosseum:colosseum@localhost:5432/colosseum_test';

/**
 * Only TEST_DATABASE_URL is read out of `.env`. Loading the whole file would
 * also pull in DATABASE_URL and make the suite talk to the developer's dev
 * database instead of colosseum_test.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.TEST_DATABASE_URL) {
      return parsed.TEST_DATABASE_URL;
    }
  }

  return DEFAULT_TEST_DATABASE_URL;
}

const TEST_DATABASE_URL = testDatabaseUrl();

// globalSetup runs in the main process, which does not receive `test.env`.
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  // Automatically generate `import` statements from JSX import source.
  // Specific to React.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    // Tests share one PostgreSQL database (colosseum_test) with a schema per
    // worker process. Sequential for now; enabling fileParallelism is safe
    // with respect to isolation but has not been measured yet.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,

    // Node environment for server-side SQL tests
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL,
      // Keep the app's dialect selection inert. Tests inject a Postgres
      // adapter explicitly via __setTestDatabaseAdapter, so a DATABASE_URL
      // inherited from the developer's shell must not leak in here.
      DATABASE_URL: '',
    },

    globalSetup: ['./tests/globalSetup.ts'],

    // Include SQL tests from tests/ directory (keeps them out of server tsc build)
    include: ['tests/**/*.test.ts'],

    // Global test timeout
    testTimeout: 10000,

    // Exclude DB infra (Postgres paths, migrations) - tested indirectly via route tests
    coverage: {
      exclude: [
        'src/server/database/connection.ts',
        'src/server/database/init.ts',
      ],
    },
  },

  resolve: {
    alias: {
      '@server': path.resolve(__dirname, './src/server'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
