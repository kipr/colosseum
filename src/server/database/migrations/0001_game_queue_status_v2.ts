/**
 * Migrate `game_queue.status` from the legacy values
 * (queued/in_progress/completed/skipped) to v2
 * (queued/called/arrived/on_table/scored).
 *
 * Postgres branch:
 *   - drops any existing CHECK constraint that mentions `status`,
 *   - rewrites legacy rows in place,
 *   - re-adds the canonical CHECK.
 *
 * SQLite branch:
 *   - if the table SQL still mentions `'skipped'`, rebuild the table
 *     using the v2 CHECK,
 *   - copy + remap rows in a transaction,
 *   - re-create the queue indexes that the rebuild dropped.
 *
 * The SQLite branch toggles `PRAGMA foreign_keys`, so the migration opts
 * out of the runner's wrapping transaction.
 */
import type { Database } from '../connection';
import type { Dialect } from '../dialect';
import type { Migration } from './runner';
import { QUEUE_STATUS_SQL, QUEUE_TYPE_SQL } from '../sqlEnums';

async function upPostgres(db: Database): Promise<void> {
  await db.exec(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN (
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'game_queue'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      ) LOOP
        EXECUTE format(
          'ALTER TABLE game_queue DROP CONSTRAINT IF EXISTS %I',
          r.conname
        );
      END LOOP;

      UPDATE game_queue
      SET status = CASE status
        WHEN 'in_progress' THEN 'on_table'
        WHEN 'completed' THEN 'scored'
        WHEN 'skipped' THEN 'queued'
        ELSE status
      END
      WHERE status IN ('in_progress', 'completed', 'skipped');

      ALTER TABLE game_queue ADD CONSTRAINT game_queue_status_check
        CHECK (status IN ${QUEUE_STATUS_SQL});
    END $$;
  `);
}

async function upSqlite(db: Database): Promise<void> {
  // Idempotency check: only rebuild if the table SQL still references the
  // legacy 'skipped' value.
  const row = await db.get<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='game_queue'`,
  );
  if (!row?.sql?.includes('skipped')) {
    return;
  }

  await db.exec(`PRAGMA foreign_keys=OFF`);
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`DROP TABLE IF EXISTS game_queue_new`);
      await tx.exec(`
        CREATE TABLE game_queue_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
          seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
          seeding_round INTEGER,
          queue_type TEXT NOT NULL CHECK (queue_type IN ${QUEUE_TYPE_SQL}),
          queue_position INTEGER NOT NULL,
          status TEXT DEFAULT 'queued'
            CHECK (status IN ${QUEUE_STATUS_SQL}),
          called_at DATETIME,
          table_number INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
            OR
            (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
          )
        )
      `);
      await tx.exec(`
        INSERT INTO game_queue_new (
          id, event_id, bracket_game_id, seeding_team_id, seeding_round,
          queue_type, queue_position, status, called_at, table_number, created_at, updated_at
        )
        SELECT
          id, event_id, bracket_game_id, seeding_team_id, seeding_round,
          queue_type, queue_position,
          CASE status
            WHEN 'in_progress' THEN 'on_table'
            WHEN 'completed' THEN 'scored'
            WHEN 'skipped' THEN 'queued'
            ELSE status
          END,
          called_at, table_number, created_at, updated_at
        FROM game_queue
      `);
      await tx.exec(`DROP TABLE game_queue`);
      await tx.exec(`ALTER TABLE game_queue_new RENAME TO game_queue`);
    });
  } finally {
    await db.exec(`PRAGMA foreign_keys=ON`);
  }

  // Recreate the queue indexes that the rebuild dropped.
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,
  );
}

const migration: Migration = {
  id: '0001_game_queue_status_v2',
  name: 'Map legacy game_queue.status values to v2 enum',
  // The SQLite branch needs to toggle PRAGMA foreign_keys outside the runner's
  // wrapping transaction, so we opt out across both dialects for symmetry.
  transactional: false,
  up: async (db, dialect: Dialect) => {
    if (dialect === 'pg') {
      await upPostgres(db);
    } else {
      await upSqlite(db);
    }
  },
};

export default migration;
