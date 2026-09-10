import { defineConfig } from 'vitest/config';
import path from 'path';
import { resolveTestDatabaseUrl } from './config/testDatabaseUrl';

const TEST_DATABASE_URL = resolveTestDatabaseUrl();

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
    // worker process. fileParallelism is isolation-safe but unmeasured:
    // extra workers each pay ~211 DDL statements on first acquire.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,

    // Node environment for server-side SQL tests
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL,
      // pg parses DATE columns into a Date at local midnight, so assertions on
      // date-only columns depend on the runner's timezone.
      TZ: 'UTC',
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
  },

  resolve: {
    alias: {
      '@server': path.resolve(__dirname, './src/server'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
