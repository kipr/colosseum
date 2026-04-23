/**
 * Migrate `game_queue.status` to its v2 enum:
 *   queued | called | arrived | on_table | scored
 *
 * The legacy schema used `queued | in_progress | completed | skipped`. Both
 * paths remap legacy values then replace the CHECK constraint atomically so
 * existing production rows survive the change.
 */

import { Database } from '../connection';
import {
  Dialect,
  queueStatusCheck,
  queueStatusValueList,
  queueTypeCheck,
} from '../dialect';
import { Migration } from './types';

async function runSqlite(db: Database): Promise<void> {
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
          queue_type TEXT NOT NULL ${queueTypeCheck},
          queue_position INTEGER NOT NULL,
          status TEXT DEFAULT 'queued'
            ${queueStatusCheck},
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

  // Re-create the indexes that lived on the old table.
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

async function runPostgres(db: Database): Promise<void> {
  // Drop any legacy CHECK on status, remap legacy values, then install the
  // canonical CHECK. Kept as a single `db.exec()` block so the parity test's
  // index-ordering assertion (drop-before-update, update-before-add) holds.
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
        CHECK (status IN (${queueStatusValueList}));
    END $$;
  `);
}

export const gameQueueStatusV2: Migration = {
  name: 'gameQueueStatusV2',
  async run(db: Database, dialect: Dialect): Promise<void> {
    try {
      if (dialect === 'postgres') {
        await runPostgres(db);
      } else {
        await runSqlite(db);
      }
    } catch (e) {
      console.warn(`game_queue status v2 migration (${dialect}):`, e);
    }
  },
};
