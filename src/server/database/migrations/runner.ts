/**
 * Numbered migration runner.
 *
 * Each migration is a small self-contained module exporting a `Migration`
 * object. The runner:
 *   1. Ensures `schema_migrations` exists.
 *   2. Reads the set of already-applied migration IDs.
 *   3. For each migration not yet applied, runs `up()` and -- on success --
 *      inserts a `schema_migrations` row.
 *
 * Migrations default to running inside a transaction so that a failure leaves
 * no partial schema and no `schema_migrations` row. Migrations that need to
 * toggle `PRAGMA foreign_keys` (SQLite table rebuilds) can opt out by setting
 * `transactional: false`; those migrations are responsible for their own
 * atomicity, but the `schema_migrations` row is still inserted only after a
 * successful `up()`.
 */
import type { Database } from '../connection';
import type { Dialect } from '../dialect';

export interface Migration {
  /** Sortable, immutable ID. Convention: `NNNN_snake_case`. */
  id: string;
  /** Human-readable label for logs. */
  name: string;
  /** If false, `up()` runs outside the runner's BEGIN/COMMIT wrapper. */
  transactional?: boolean;
  /** Idempotent migration body. */
  up: (db: Database, dialect: Dialect) => Promise<void>;
}

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export async function ensureSchemaMigrationsTable(db: Database): Promise<void> {
  await db.exec(SCHEMA_MIGRATIONS_DDL);
}

async function getAppliedIds(db: Database): Promise<Set<string>> {
  const rows = await db.all<{ id: string }>(`SELECT id FROM schema_migrations`);
  return new Set(rows.map((r) => r.id));
}

async function recordMigration(db: Database, m: Migration): Promise<void> {
  await db.run(
    `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [m.id, m.name],
  );
}

export async function runMigrations(
  db: Database,
  dialect: Dialect,
  migrations: readonly Migration[],
): Promise<void> {
  await ensureSchemaMigrationsTable(db);
  const applied = await getAppliedIds(db);

  for (const m of migrations) {
    if (applied.has(m.id)) continue;

    const transactional = m.transactional !== false;

    if (transactional) {
      // Wrap in a transaction so failure leaves no partial schema and no
      // `schema_migrations` row. We run the `up()` body and the bookkeeping
      // INSERT inside the same transaction.
      await db.transaction(async (tx) => {
        await m.up(db, dialect);
        await tx.run(
          `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [m.id, m.name],
        );
      });
    } else {
      // Non-transactional migration (e.g. SQLite table rebuild that toggles
      // PRAGMA foreign_keys). It's responsible for its own atomicity.
      await m.up(db, dialect);
      await recordMigration(db, m);
    }
  }
}
