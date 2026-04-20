/**
 * Mark historical migrations as already-applied on databases where their
 * effects are already present.
 *
 * On first startup of the new code:
 *   - On a fresh DB, the baseline already creates every table with all the
 *     columns these migrations would add, so we record them as applied.
 *   - On a production DB that has been running the previous inline-ALTER
 *     style of migration, every migrated artefact is also already present;
 *     we record them as applied so we don't re-run an `ADD COLUMN IF NOT
 *     EXISTS` (no-op, but noisy) or the heavy `0001_game_queue_status_v2`.
 *
 * The detection logic is intentionally narrow: each migration ID maps to a
 * single check (a column that the migration adds, or in the case of FK
 * migrations a constraint name). If the check passes, the migration is
 * pre-marked applied. Otherwise the runner will execute it normally.
 */
import type { Database } from '../connection';
import type { Dialect } from '../dialect';
import { ensureSchemaMigrationsTable } from './runner';

interface ColumnCheck {
  kind: 'column';
  table: string;
  column: string;
}

interface ConstraintCheck {
  kind: 'constraint';
  table: string;
  constraint: string;
}

interface GameQueueV2Check {
  kind: 'game_queue_v2';
}

type Check = ColumnCheck | ConstraintCheck | GameQueueV2Check;

interface BackfillEntry {
  id: string;
  name: string;
  check: Check;
}

const BACKFILL_ENTRIES: readonly BackfillEntry[] = [
  {
    id: '0001_game_queue_status_v2',
    name: 'Map legacy game_queue.status values to v2 enum',
    check: { kind: 'game_queue_v2' },
  },
  {
    id: '0002_events_score_accept_mode',
    name: 'Add events.score_accept_mode column',
    check: { kind: 'column', table: 'events', column: 'score_accept_mode' },
  },
  {
    id: '0003_events_spectator_results_released',
    name: 'Add events.spectator_results_released column',
    check: {
      kind: 'column',
      table: 'events',
      column: 'spectator_results_released',
    },
  },
  {
    id: '0004_spreadsheet_configs_auto_accept',
    name: 'Add spreadsheet_configs.auto_accept column',
    check: {
      kind: 'column',
      table: 'spreadsheet_configs',
      column: 'auto_accept',
    },
  },
  {
    id: '0005_brackets_weight',
    name: 'Add brackets.weight column',
    check: { kind: 'column', table: 'brackets', column: 'weight' },
  },
  {
    id: '0006_bracket_entries_ranking_columns',
    name: 'Add bracket_entries ranking columns',
    check: { kind: 'column', table: 'bracket_entries', column: 'final_rank' },
  },
  {
    id: '0007_score_submissions_event_scoped_columns',
    name: 'Add score_submissions event-scoped columns',
    check: {
      kind: 'column',
      table: 'score_submissions',
      column: 'game_queue_id',
    },
  },
  {
    id: '0008_score_submissions_bracket_game_fk',
    name: 'Add score_submissions -> bracket_games FK',
    check: {
      kind: 'constraint',
      table: 'score_submissions',
      constraint: 'score_submissions_bracket_game_id_fkey',
    },
  },
  {
    id: '0009_score_submissions_game_queue_fk',
    name: 'Add score_submissions -> game_queue FK',
    check: {
      kind: 'constraint',
      table: 'score_submissions',
      constraint: 'score_submissions_game_queue_id_fkey',
    },
  },
  {
    id: '0010_users_last_activity',
    name: 'Add users.last_activity column',
    check: { kind: 'column', table: 'users', column: 'last_activity' },
  },
];

async function tableExists(
  db: Database,
  dialect: Dialect,
  table: string,
): Promise<boolean> {
  if (dialect === 'pg') {
    const row = await db.get<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table],
    );
    return !!row?.exists;
  }
  const row = await db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  return !!row;
}

async function columnExists(
  db: Database,
  dialect: Dialect,
  table: string,
  column: string,
): Promise<boolean> {
  if (!(await tableExists(db, dialect, table))) return false;
  if (dialect === 'pg') {
    const row = await db.get<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
       ) AS exists`,
      [table, column],
    );
    return !!row?.exists;
  }
  const rows = await db.all<{ name: string }>(
    `SELECT name FROM pragma_table_info(?)`,
    [table],
  );
  return rows.some((r) => r.name === column);
}

async function constraintExists(
  db: Database,
  dialect: Dialect,
  table: string,
  constraint: string,
): Promise<boolean> {
  if (dialect !== 'pg') {
    // SQLite expresses these inline; treat as already present iff the FK
    // column exists (the baseline always declares both together).
    return true;
  }
  if (!(await tableExists(db, dialect, table))) return false;
  const row = await db.get<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND table_name = $1
         AND constraint_name = $2
     ) AS exists`,
    [table, constraint],
  );
  return !!row?.exists;
}

async function gameQueueV2Applied(
  db: Database,
  dialect: Dialect,
): Promise<boolean> {
  if (!(await tableExists(db, dialect, 'game_queue'))) return false;
  if (dialect === 'pg') {
    const row = await db.get<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         WHERE t.relname = 'game_queue'
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%status%'
           AND pg_get_constraintdef(c.oid) NOT ILIKE '%skipped%'
           AND pg_get_constraintdef(c.oid) NOT ILIKE '%in_progress%'
           AND pg_get_constraintdef(c.oid) NOT ILIKE '%completed%'
       ) AS exists`,
    );
    return !!row?.exists;
  }
  const row = await db.get<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='game_queue'`,
  );
  if (!row?.sql) return false;
  return !row.sql.includes('skipped');
}

async function isAlreadyApplied(
  db: Database,
  dialect: Dialect,
  check: Check,
): Promise<boolean> {
  switch (check.kind) {
    case 'column':
      return columnExists(db, dialect, check.table, check.column);
    case 'constraint':
      return constraintExists(db, dialect, check.table, check.constraint);
    case 'game_queue_v2':
      return gameQueueV2Applied(db, dialect);
  }
}

export async function backfillBaselineMigrations(
  db: Database,
  dialect: Dialect,
): Promise<void> {
  await ensureSchemaMigrationsTable(db);

  const appliedRows = await db.all<{ id: string }>(
    `SELECT id FROM schema_migrations`,
  );
  const applied = new Set(appliedRows.map((r) => r.id));

  for (const entry of BACKFILL_ENTRIES) {
    if (applied.has(entry.id)) continue;
    if (!(await isAlreadyApplied(db, dialect, entry.check))) continue;
    await db.run(
      `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [entry.id, entry.name],
    );
  }
}
