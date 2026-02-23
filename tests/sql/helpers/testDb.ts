/**
 * Test database helper - creates an in-memory SQLite database
 * with the full schema applied for integration tests.
 */
import SQLite from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import {
  createSqliteDatabase,
  Database,
} from '../../../src/server/database/connection';
import { initializeSQLite } from '../../../src/server/database/init';

export interface TestDb {
  /** The underlying better-sqlite3 Database instance */
  sqlite: SQLiteDatabase;
  /** The Database adapter interface (same as production code uses) */
  db: Database;
  /** Close the database connection */
  close: () => void;
}

/**
 * Create a fresh in-memory SQLite database with the full schema applied.
 * Each call returns a new, isolated database.
 */
export async function createTestDb(): Promise<TestDb> {
  // Create in-memory SQLite database
  const sqlite = new SQLite(':memory:');

  // Wrap with our Database adapter
  const db = createSqliteDatabase(sqlite);

  // Apply the full schema (same as production SQLite initialization)
  await initializeSQLite(db);

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}

/**
 * Create a minimal test database without the full schema.
 * Useful for testing the adapter itself without schema overhead.
 */
export function createMinimalTestDb(): TestDb {
  const sqlite = new SQLite(':memory:');
  const db = createSqliteDatabase(sqlite);

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
