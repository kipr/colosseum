/**
 * Database initialization orchestrator.
 *
 * On startup we:
 *   1. Apply the baseline (per-table CREATE statements, indexes, triggers).
 *      Every statement is `IF NOT EXISTS`-style so this is safe on fresh
 *      and existing databases.
 *   2. Backfill `schema_migrations` rows for any historical migrations
 *      whose effects are already present in the live schema. This protects
 *      the production Postgres database from being re-migrated.
 *   3. Run any unapplied migrations.
 *
 * The `initializeSQLite` and `initializePostgres` exports are preserved so
 * `tests/sql/helpers/testDb.ts` and the Postgres parity test keep working
 * without churn. Both call the same orchestrator with a fixed dialect.
 */
import fs from 'fs';
import path from 'path';
import { getDatabase, type Database } from './connection';
import { currentDialect, type Dialect } from './dialect';
import { TABLES_IN_ORDER } from './tables';
import { BASELINE_INDEXES } from './indexes';
import { emitUpdatedAtTriggers, emitCleanupTriggers } from './triggers';
import { runMigrations } from './migrations/runner';
import { backfillBaselineMigrations } from './migrations/backfill';
import { MIGRATIONS } from './migrations';

async function applyBaseline(db: Database, dialect: Dialect): Promise<void> {
  for (const table of TABLES_IN_ORDER) {
    const ddl = dialect === 'pg' ? table.pg : table.sqlite;
    const trimmed = ddl.trim();
    if (!trimmed) continue;
    await db.exec(ddl);
  }

  await emitUpdatedAtTriggers(db, dialect);
  await emitCleanupTriggers(db, dialect);

  for (const sql of BASELINE_INDEXES) {
    await db.exec(sql);
  }
}

async function applyBaselineAndMigrate(
  db: Database,
  dialect: Dialect,
): Promise<void> {
  await applyBaseline(db, dialect);
  await backfillBaselineMigrations(db, dialect);
  await runMigrations(db, dialect, MIGRATIONS);
}

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();
  const dialect = currentDialect();

  if (dialect === 'sqlite') {
    const dbDir = path.join(__dirname, '../../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  await applyBaselineAndMigrate(db, dialect);

  console.log('✅ Database initialized successfully');
}

/**
 * Initialize Postgres schema. Exported for the parity test, which records
 * every emitted SQL statement against a stub adapter.
 */
export async function initializePostgres(db: Database): Promise<void> {
  await applyBaselineAndMigrate(db, 'pg');
}

/**
 * Initialize SQLite schema. Exported for use by tests with in-memory
 * databases (`tests/sql/helpers/testDb.ts`).
 */
export async function initializeSQLite(db: Database): Promise<void> {
  await applyBaselineAndMigrate(db, 'sqlite');
}
