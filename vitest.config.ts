import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Run tests sequentially for SQLite + better-sqlite3 compatibility
    // (native bindings + in-memory DBs work better this way)
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,

    // Node environment for server-side SQL tests
    environment: 'node',

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
    },
  },
});
