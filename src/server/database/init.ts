/**
 * Database initialization entry point.
 *
 * Schema lives in three places:
 *   - `schema/tables.ts`    — dialect-aware CREATE TABLE definitions
 *   - `schema/indexes.ts`   — shared CREATE INDEX statements
 *   - `schema/triggers.ts`  — per-dialect trigger emitters
 *
 * Discrete migrations (column backfills, deferred FKs, the queue-status v2
 * rewrite) live in `migrations/` and run after all tables exist.
 */

import fs from 'fs';
import path from 'path';
import { Database, getDatabase } from './connection';
import { Dialect } from './dialect';
import { runMigrations } from './migrations';
import { ALL_INDEXES, POSTGRES_ONLY_INDEXES } from './schema/indexes';
import { ALL_TABLES, POSTGRES_ONLY_TABLES } from './schema/tables';
import { applyPostgresTriggers, applySqliteTriggers } from './schema/triggers';

const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();

  if (!usePostgres) {
    // Ensure database directory exists for SQLite
    const dbDir = path.join(__dirname, '../../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  if (usePostgres) {
    await initializePostgres(db);
  } else {
    await initializeSQLite(db);
  }

  console.log('✅ Database initialized successfully');
}

async function applyTables(db: Database, dialect: Dialect): Promise<void> {
  for (const table of ALL_TABLES) {
    await db.exec(table(dialect));
  }
  if (dialect === 'postgres') {
    for (const table of POSTGRES_ONLY_TABLES) {
      await db.exec(table());
    }
  }
}

async function applyIndexes(db: Database, dialect: Dialect): Promise<void> {
  for (const idx of ALL_INDEXES) {
    await db.exec(idx);
  }
  if (dialect === 'postgres') {
    for (const idx of POSTGRES_ONLY_INDEXES) {
      await db.exec(idx);
    }
  }
}

export async function initializePostgres(db: Database): Promise<void> {
  await applyTables(db, 'postgres');
  await runMigrations(db, 'postgres');
  await applyPostgresTriggers(db);
  await applyIndexes(db, 'postgres');
}

/**
 * Initialize SQLite schema. Exported for use by tests with in-memory
 * databases.
 */
export async function initializeSQLite(db: Database): Promise<void> {
  await applyTables(db, 'sqlite');
  await runMigrations(db, 'sqlite');
  await applySqliteTriggers(db);
  await applyIndexes(db, 'sqlite');
}
