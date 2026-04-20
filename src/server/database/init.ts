import { getDatabase, Database } from './connection';
import fs from 'fs';
import path from 'path';
import { EVENT_STATUSES } from '../../shared/domain/eventStatus';
import { SCORE_ACCEPT_MODES } from '../../shared/domain/scoreAcceptMode';
import { TEAM_STATUSES } from '../../shared/domain/teamStatus';
import { QUEUE_STATUSES, QUEUE_TYPES } from '../../shared/domain/queue';
import {
  BRACKET_STATUSES,
  BRACKET_SIDES,
  GAME_STATUSES,
} from '../../shared/domain/bracket';

/**
 * Render an `IN (...)` SQL fragment from a list of canonical enum values.
 * Used to derive CHECK constraints from the shared domain arrays so the
 * schema cannot drift from the TypeScript enums.
 */
function sqlEnumIn(values: readonly string[]): string {
  return `(${values.map((v) => `'${v}'`).join(', ')})`;
}

const EVENT_STATUS_SQL = sqlEnumIn(EVENT_STATUSES);
const SCORE_ACCEPT_MODE_SQL = sqlEnumIn(SCORE_ACCEPT_MODES);
const TEAM_STATUS_SQL = sqlEnumIn(TEAM_STATUSES);
const QUEUE_STATUS_SQL = sqlEnumIn(QUEUE_STATUSES);
const QUEUE_TYPE_SQL = sqlEnumIn(QUEUE_TYPES);
const BRACKET_STATUS_SQL = sqlEnumIn(BRACKET_STATUSES);
const BRACKET_SIDE_SQL = sqlEnumIn(BRACKET_SIDES);
const GAME_STATUS_SQL = sqlEnumIn(GAME_STATUSES);

/**
 * SQLite: rebuild `game_queue` when an older schema used legacy status values.
 * Must run before triggers/indexes that assume the v2 CHECK (see MIGRATION block below).
 */
async function migrateGameQueueStatusV2SQLite(db: Database): Promise<void> {
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

/**
 * PostgreSQL: replace any legacy `game_queue.status` CHECK before rewriting
 * old values so existing production rows can be migrated atomically.
 */
async function migrateGameQueueStatusV2Postgres(db: Database): Promise<void> {
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

export async function initializePostgres(db: Database): Promise<void> {
  // ============================================================================
  // CORE TABLES
  // ============================================================================

  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at BIGINT,
      is_admin BOOLEAN DEFAULT FALSE,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.exec(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    );
  } catch {
    // Column might already exist or syntax not supported
  }

  // Spreadsheet configurations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT DEFAULT 'scores',
      is_active BOOLEAN DEFAULT TRUE,
      auto_accept BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.exec(
      `ALTER TABLE spreadsheet_configs ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN DEFAULT FALSE`,
    );
  } catch {
    // Column might already exist
  }

  // Scoresheet field templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // TOURNAMENT/EVENT MANAGEMENT
  // ============================================================================

  // Events/Tournaments
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_date DATE,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ${EVENT_STATUS_SQL}),
      seeding_rounds INTEGER DEFAULT 3,
      score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ${SCORE_ACCEPT_MODE_SQL}),
      spectator_results_released INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.exec(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS score_accept_mode TEXT NOT NULL DEFAULT 'manual'`,
    );
  } catch {
    // Column might already exist
  }

  try {
    await db.exec(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS spectator_results_released INTEGER NOT NULL DEFAULT 0`,
    );
  } catch {
    // Column might already exist
  }

  // ============================================================================
  // TEAMS
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_number INTEGER NOT NULL CHECK (team_number > 0),
      team_name TEXT NOT NULL,
      display_name TEXT,
      status TEXT DEFAULT 'registered'
        CHECK (status IN ${TEAM_STATUS_SQL}),
      checked_in_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_number)
    )
  `);

  // ============================================================================
  // SEEDING
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS seeding_scores (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL CHECK (round_number > 0),
      score INTEGER,
      score_submission_id INTEGER,
      scored_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, round_number)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS seeding_rankings (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      seed_average REAL,
      seed_rank INTEGER CHECK (seed_rank > 0),
      raw_seed_score REAL,
      tiebreaker_value REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id)
    )
  `);

  // ============================================================================
  // DOCUMENTATION SCORES
  // ============================================================================

  // Global documentation categories (shared across events)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      weight REAL NOT NULL DEFAULT 1.0,
      max_score REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event-to-category junction (ordinal is event-specific)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_documentation_categories (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, ordinal),
      UNIQUE(event_id, category_id)
    )
  `);

  // Documentation scores - one row per team per event (overall score + metadata)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_scores (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      overall_score REAL,
      scored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scored_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_id)
    )
  `);

  // Documentation sub-scores - individual category scores per team
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_sub_scores (
      id SERIAL PRIMARY KEY,
      documentation_score_id INTEGER NOT NULL
        REFERENCES documentation_scores(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL
        REFERENCES documentation_categories(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(documentation_score_id, category_id)
    )
  `);

  // ============================================================================
  // BRACKETS
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS brackets (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL,
      actual_team_count INTEGER,
      status TEXT DEFAULT 'setup'
        CHECK (status IN ${BRACKET_STATUS_SQL}),
      weight REAL NOT NULL DEFAULT 1.0
        CHECK (weight > 0 AND weight <= 1),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.exec(
      `ALTER TABLE brackets ADD COLUMN IF NOT EXISTS weight REAL NOT NULL DEFAULT 1.0`,
    );
  } catch {
    // Column might already exist
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_entries (
      id SERIAL PRIMARY KEY,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      seed_position INTEGER NOT NULL,
      initial_slot INTEGER,
      is_bye BOOLEAN DEFAULT FALSE,
      final_rank INTEGER,
      bracket_raw_score REAL,
      weighted_bracket_raw_score REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bracket_id, team_id),
      UNIQUE(bracket_id, seed_position),
      CHECK (
        (is_bye = TRUE AND team_id IS NULL) OR
        (is_bye = FALSE AND team_id IS NOT NULL)
      )
    )
  `);

  try {
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS final_rank INTEGER`,
    );
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS bracket_raw_score REAL`,
    );
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS weighted_bracket_raw_score REAL`,
    );
  } catch {
    // Columns might already exist
  }

  // Score submissions (must be created before bracket_games due to FK)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL,
      submitted_to_sheet BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      bracket_game_id INTEGER,
      seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL,
      score_type TEXT,
      game_queue_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add event-scoped columns if missing (migration)
  try {
    await db.exec(
      `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL`,
    );
    await db.exec(
      `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS bracket_game_id INTEGER`,
    );
    await db.exec(
      `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL`,
    );
    await db.exec(
      `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS score_type TEXT`,
    );
    await db.exec(
      `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS game_queue_id INTEGER`,
    );
  } catch {
    // Columns might already exist
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_games (
      id SERIAL PRIMARY KEY,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      game_number INTEGER NOT NULL,
      round_name TEXT,
      round_number INTEGER,
      bracket_side TEXT
        CHECK (bracket_side IN ${BRACKET_SIDE_SQL}),
      team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team1_source TEXT,
      team2_source TEXT,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ${GAME_STATUS_SQL}),
      winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      winner_advances_to_id INTEGER REFERENCES bracket_games(id),
      loser_advances_to_id INTEGER REFERENCES bracket_games(id),
      winner_slot TEXT,
      loser_slot TEXT,
      team1_score INTEGER,
      team2_score INTEGER,
      score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
      scheduled_time TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bracket_id, game_number)
    )
  `);

  // Add deferred FK from score_submissions -> bracket_games now that both tables exist
  // (Postgres CREATE TABLE IF NOT EXISTS won't fail on the missing FK, but we add it if needed)
  try {
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'score_submissions_bracket_game_id_fkey'
            AND table_name = 'score_submissions'
        ) THEN
          ALTER TABLE score_submissions
            ADD CONSTRAINT score_submissions_bracket_game_id_fkey
            FOREIGN KEY (bracket_game_id) REFERENCES bracket_games(id) ON DELETE SET NULL;
        END IF;
      END $$
    `);
  } catch {
    // FK might already exist
  }

  // ============================================================================
  // SCORE DETAILS
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_details (
      id SERIAL PRIMARY KEY,
      score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL,
      field_value TEXT,
      calculated_value INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // EVENT-SCORESHEET LINKS
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      template_type TEXT NOT NULL
        CHECK (template_type IN ('seeding', 'bracket')),
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, template_id, template_type)
    )
  `);

  // ============================================================================
  // GAME QUEUE / SCHEDULING
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_queue (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
      seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      seeding_round INTEGER,
      queue_type TEXT NOT NULL CHECK (queue_type IN ${QUEUE_TYPE_SQL}),
      queue_position INTEGER NOT NULL,
      status TEXT DEFAULT 'queued'
        CHECK (status IN ${QUEUE_STATUS_SQL}),
      called_at TIMESTAMP,
      table_number INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
        OR
        (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
      )
    )
  `);

  // Add deferred FK from score_submissions -> game_queue now that table exists
  try {
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'score_submissions_game_queue_id_fkey'
            AND table_name = 'score_submissions'
        ) THEN
          ALTER TABLE score_submissions
            ADD CONSTRAINT score_submissions_game_queue_id_fkey
            FOREIGN KEY (game_queue_id) REFERENCES game_queue(id) ON DELETE SET NULL;
        END IF;
      END $$
    `);
  } catch {
    // FK might already exist
  }

  // ============================================================================
  // MIGRATION: game_queue.status enum v2 (Postgres)
  // Maps legacy values, then replaces CHECK constraint with queued/called/arrived/on_table/scored.
  // ============================================================================
  try {
    await migrateGameQueueStatusV2Postgres(db);
  } catch (e) {
    console.warn('game_queue status v2 migration (Postgres):', e);
  }

  // ============================================================================
  // BRACKET TEMPLATES
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_templates (
      id SERIAL PRIMARY KEY,
      bracket_size INTEGER NOT NULL,
      game_number INTEGER NOT NULL,
      round_name TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      bracket_side TEXT NOT NULL,
      team1_source TEXT NOT NULL,
      team2_source TEXT NOT NULL,
      winner_advances_to INTEGER,
      loser_advances_to INTEGER,
      winner_slot TEXT CHECK (winner_slot IN ('team1', 'team2')),
      loser_slot TEXT,
      is_championship BOOLEAN DEFAULT FALSE,
      is_grand_final BOOLEAN DEFAULT FALSE,
      is_reset_game BOOLEAN DEFAULT FALSE,
      UNIQUE(bracket_size, game_number)
    )
  `);

  // ============================================================================
  // AUDIT LOG
  // ============================================================================

  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Active sessions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chat messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      spreadsheet_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Session store table for connect-pg-simple
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" VARCHAR NOT NULL COLLATE "default",
      "sess" JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);

  // ============================================================================
  // AWARDS
  // ============================================================================

  // Global award catalog (reusable across events)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS award_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event-specific award instances (snapshot of name/description from template)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_awards (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_award_id INTEGER REFERENCES award_templates(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recipients of an event award (many-to-many with teams)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_award_recipients (
      id SERIAL PRIMARY KEY,
      event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_award_id, team_id)
    )
  `);

  // ============================================================================
  // TRIGGERS
  // ============================================================================

  // Shared trigger function for updated_at columns
  await db.exec(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.updated_at = OLD.updated_at THEN
        NEW.updated_at = CURRENT_TIMESTAMP;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  for (const table of [
    'users',
    'spreadsheet_configs',
    'scoresheet_field_templates',
    'scoresheet_templates',
    'score_submissions',
    'events',
    'teams',
    'seeding_scores',
    'seeding_rankings',
    'brackets',
    'bracket_games',
    'game_queue',
    'documentation_scores',
    'award_templates',
    'event_awards',
  ]) {
    await db.exec(`
      DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table};
      CREATE TRIGGER ${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  // Clear teams.checked_in_at when status changes back to registered or no_show
  await db.exec(`
    CREATE OR REPLACE FUNCTION teams_clear_checked_in_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL THEN
        NEW.checked_in_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS teams_clear_checked_in_at_on_status ON teams;
    CREATE TRIGGER teams_clear_checked_in_at_on_status
      BEFORE UPDATE ON teams
      FOR EACH ROW
      EXECUTE FUNCTION teams_clear_checked_in_at()
  `);

  // Clear game_queue.called_at when status changes back to queued
  await db.exec(`
    CREATE OR REPLACE FUNCTION game_queue_clear_called_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'queued' AND NEW.called_at IS NOT NULL THEN
        NEW.called_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS game_queue_clear_called_at_on_queued ON game_queue;
    CREATE TRIGGER game_queue_clear_called_at_on_queued
      BEFORE UPDATE ON game_queue
      FOR EACH ROW
      EXECUTE FUNCTION game_queue_clear_called_at()
  `);

  // Clear seeding_scores.scored_at when score is removed
  await db.exec(`
    CREATE OR REPLACE FUNCTION seeding_scores_clear_scored_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL) THEN
        NEW.scored_at = NULL;
        NEW.score_submission_id = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS seeding_scores_clear_scored_at_when_score_null ON seeding_scores;
    CREATE TRIGGER seeding_scores_clear_scored_at_when_score_null
      BEFORE UPDATE ON seeding_scores
      FOR EACH ROW
      EXECUTE FUNCTION seeding_scores_clear_scored_at()
  `);

  // Clear bracket_games timestamps when status is rolled back to pending/ready
  await db.exec(`
    CREATE OR REPLACE FUNCTION bracket_games_clear_times_on_rollback()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN
        NEW.started_at = NULL;
        NEW.completed_at = NULL;
      ELSIF NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL THEN
        NEW.completed_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS bracket_games_clear_times_on_status_rollback ON bracket_games;
    CREATE TRIGGER bracket_games_clear_times_on_status_rollback
      BEFORE UPDATE ON bracket_games
      FOR EACH ROW
      EXECUTE FUNCTION bracket_games_clear_times_on_rollback()
  `);

  // ============================================================================
  // INDEXES
  // ============================================================================

  // Core indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`,
  );

  // Event/team indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`,
  );

  // Bracket indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`,
  );

  // Bracket revert traversal indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1_source ON bracket_games(bracket_id, team1_source)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2_source ON bracket_games(bracket_id, team2_source)`,
  );

  // Queue indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,
  );

  // Score submissions event-scoped indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status, created_at DESC)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_type ON score_submissions(event_id, score_type, created_at DESC)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_game_queue ON score_submissions(game_queue_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_bracket_game ON score_submissions(bracket_game_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_seeding_score ON score_submissions(seeding_score_id)`,
  );

  // Other indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
  );

  // Documentation score indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_event ON event_documentation_categories(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_category ON event_documentation_categories(category_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id)`,
  );

  // Awards indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
  );
}

/**
 * Initialize SQLite schema. Exported for use by tests with in-memory databases.
 */
export async function initializeSQLite(db: Database): Promise<void> {
  // SQLite schema (existing schema)

  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      is_admin BOOLEAN DEFAULT 0,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Spreadsheet configurations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT DEFAULT 'scores',
      is_active BOOLEAN DEFAULT 1,
      auto_accept BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Scoresheet field templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Score submissions (enhanced with event/bracket context from spec)
  // spreadsheet_config_id nullable for DB-backed (event-scoped) scores
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      template_id INTEGER NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id) ON DELETE SET NULL,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL,
      submitted_to_sheet BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE SET NULL,
      seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL,
      score_type TEXT,
      game_queue_id INTEGER REFERENCES game_queue(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Active sessions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE
    )
  `);

  // Chat messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spreadsheet_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // ============================================================================
  // TOURNAMENT/EVENT MANAGEMENT
  // ============================================================================

  // Events/Tournaments - Top-level container for competition days
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      event_date DATE,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ${EVENT_STATUS_SQL}),
      seeding_rounds INTEGER DEFAULT 3,
      score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ${SCORE_ACCEPT_MODE_SQL}),
      spectator_results_released INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // TEAMS
  // ============================================================================

  // Teams - Master list of participating teams per event
  await db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_number INTEGER NOT NULL CHECK (team_number > 0),
      team_name TEXT NOT NULL,
      display_name TEXT,
      status TEXT DEFAULT 'registered'
        CHECK (status IN ${TEAM_STATUS_SQL}),
      checked_in_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_number)
    )
  `);

  // ============================================================================
  // SEEDING
  // ============================================================================

  // Seeding Scores - Individual round scores for each team
  await db.exec(`
    CREATE TABLE IF NOT EXISTS seeding_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL CHECK (round_number > 0),
      score INTEGER,
      score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
      scored_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, round_number)
    )
  `);

  // Seeding Rankings - Computed/cached seeding results per team
  // Recalculated when scores change
  await db.exec(`
    CREATE TABLE IF NOT EXISTS seeding_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      seed_average REAL,
      seed_rank INTEGER CHECK (seed_rank > 0),
      raw_seed_score REAL,
      tiebreaker_value REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id)
    )
  `);

  // ============================================================================
  // DOCUMENTATION SCORES
  // ============================================================================

  // Global documentation categories (shared across events)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      weight REAL NOT NULL DEFAULT 1.0,
      max_score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event-to-category junction (ordinal is event-specific)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_documentation_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, ordinal),
      UNIQUE(event_id, category_id)
    )
  `);

  // Documentation scores - one row per team per event (overall score + metadata)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      overall_score REAL,
      scored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scored_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_id)
    )
  `);

  // Documentation sub-scores - individual category scores per team
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentation_sub_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documentation_score_id INTEGER NOT NULL
        REFERENCES documentation_scores(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL
        REFERENCES documentation_categories(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(documentation_score_id, category_id)
    )
  `);

  // ============================================================================
  // BRACKETS
  // ============================================================================

  // Brackets - Container for a double-elimination bracket
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brackets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL,
      actual_team_count INTEGER,
      status TEXT DEFAULT 'setup'
        CHECK (status IN ${BRACKET_STATUS_SQL}),
      weight REAL NOT NULL DEFAULT 1.0
        CHECK (weight > 0 AND weight <= 1),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bracket Entries - Teams assigned to a bracket with their seeding position
  // NOTE: In the schema, team_id can point to a team in a different event than the bracket.
  // Make sure this cannot happen at application-level.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      seed_position INTEGER NOT NULL,
      initial_slot INTEGER,
      is_bye BOOLEAN DEFAULT FALSE,
      final_rank INTEGER,
      bracket_raw_score REAL,
      weighted_bracket_raw_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bracket_id, team_id),
      UNIQUE(bracket_id, seed_position),
      CHECK (
        (is_bye = 1 AND team_id IS NULL) OR
        (is_bye = 0 AND team_id IS NOT NULL)
      )
    )
  `);

  // Games/Matches - Individual games within a bracket
  // NOTE team1_id/team2_id/winner_id/loser_id can point across events.
  // Make sure this cannot happen at application-level.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      game_number INTEGER NOT NULL,
      round_name TEXT,
      round_number INTEGER,
      bracket_side TEXT
        CHECK (bracket_side IN ${BRACKET_SIDE_SQL}),
      team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team1_source TEXT,
      team2_source TEXT,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ${GAME_STATUS_SQL}),
      winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      winner_advances_to_id INTEGER REFERENCES bracket_games(id),
      loser_advances_to_id INTEGER REFERENCES bracket_games(id),
      winner_slot TEXT,
      loser_slot TEXT,
      team1_score INTEGER,
      team2_score INTEGER,
      score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
      scheduled_time DATETIME,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bracket_id, game_number)
    )
  `);

  // ============================================================================
  // SCORE SUBMISSIONS (Enhanced from existing)
  // ============================================================================

  // Score Submission Details - Detailed field-by-field scores
  // (The score_data JSON blob is kept for flexibility, but this provides queryable structure)
  // score_details is canonical: JSON is entirely derived at application-level
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL,
      field_value TEXT,
      calculated_value INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // SCORESHEET TEMPLATES (Enhanced)
  // ============================================================================

  // Link templates to events for event-specific scoring rules

  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      template_type TEXT NOT NULL
        CHECK (template_type IN ('seeding', 'bracket')),
      is_default BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, template_id, template_type)
    )
  `);

  // ============================================================================
  // GAME QUEUE / SCHEDULING
  // ============================================================================

  // Game Queue - Ordered list of games ready for judging
  // Ensure we never queue the same game twice at application level
  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_queue (
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

  // ============================================================================
  // MIGRATION: game_queue.status enum v2 (SQLite)
  // Rebuild table when legacy CHECK listed skipped/in_progress/completed.
  // ============================================================================
  try {
    await migrateGameQueueStatusV2SQLite(db);
  } catch (e) {
    console.warn('game_queue status v2 migration (SQLite):', e);
  }

  // ============================================================================
  // BRACKET TEMPLATES (For generating bracket structures)
  // ============================================================================

  // Pre-defined bracket game templates for standard DE bracket sizes
  // This replaces the hardcoded lookup tables in bracketParser.ts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_size INTEGER NOT NULL,
      game_number INTEGER NOT NULL,
      round_name TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      bracket_side TEXT NOT NULL,
      team1_source TEXT NOT NULL,
      team2_source TEXT NOT NULL,
      winner_advances_to INTEGER,
      loser_advances_to INTEGER,
      winner_slot TEXT CHECK (winner_slot IN ('team1', 'team2')),
      loser_slot TEXT,
      is_championship BOOLEAN DEFAULT FALSE,
      is_grand_final BOOLEAN DEFAULT FALSE,
      is_reset_game BOOLEAN DEFAULT FALSE,
      UNIQUE(bracket_size, game_number)
    )
  `);

  // ============================================================================
  // AUDIT LOG
  // ============================================================================

  // Track important changes for accountability
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // AWARDS
  // ============================================================================

  // Global award catalog (reusable across events)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS award_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event-specific award instances (snapshot of name/description from template)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_award_id INTEGER REFERENCES award_templates(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recipients of an event award (many-to-many with teams)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_award_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_award_id, team_id)
    )
  `);

  // Triggers to update updated_at on all tables that have it
  for (const table of [
    'users',
    'spreadsheet_configs',
    'scoresheet_field_templates',
    'scoresheet_templates',
    'score_submissions',
    'events',
    'teams',
    'seeding_scores',
    'seeding_rankings',
    'brackets',
    'bracket_games',
    'game_queue',
    'documentation_scores',
    'award_templates',
    'event_awards',
  ]) {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_updated_at
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE ${table}
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END
    `);
  }

  // ============================================================================
  // TRIGGERS FOR TIMESTAMP CLEANUP
  // ============================================================================

  // Clear teams.checked_in_at when status changes back to registered or no_show
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS teams_clear_checked_in_at_on_status
    AFTER UPDATE OF status ON teams
    FOR EACH ROW
    WHEN NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL
    BEGIN
      UPDATE teams
      SET checked_in_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // Clear game_queue.called_at when status changes back to queued
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS game_queue_clear_called_at_on_queued
    AFTER UPDATE OF status ON game_queue
    FOR EACH ROW
    WHEN NEW.status = 'queued' AND NEW.called_at IS NOT NULL
    BEGIN
      UPDATE game_queue
      SET called_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // Clear seeding_scores.scored_at when score is removed
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS seeding_scores_clear_scored_at_when_score_null
    AFTER UPDATE OF score ON seeding_scores
    FOR EACH ROW
    WHEN NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL)
    BEGIN
      UPDATE seeding_scores
      SET scored_at = NULL, score_submission_id = NULL
      WHERE id = NEW.id;
    END
  `);

  // Clear bracket_games timestamps when status is rolled back to pending/ready
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS bracket_games_clear_times_on_status_rollback
    AFTER UPDATE OF status ON bracket_games
    FOR EACH ROW
    WHEN NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL)
    BEGIN
      UPDATE bracket_games
      SET started_at = NULL, completed_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // Clear bracket_games.completed_at when status is rolled back to in_progress
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS bracket_games_clear_completed_at_on_in_progress
    AFTER UPDATE OF status ON bracket_games
    FOR EACH ROW
    WHEN NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL
    BEGIN
      UPDATE bracket_games
      SET completed_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // ============================================================================
  // INDEXES
  // ============================================================================

  // Core indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`,
  );

  // Event/team indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`,
  );

  // Bracket indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`,
  );

  // Bracket revert traversal indexes (team source lookups)
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1_source ON bracket_games(bracket_id, team1_source)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2_source ON bracket_games(bracket_id, team2_source)`,
  );

  // Queue indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,
  );

  // Score submissions event-scoped indexes (Phase 6)
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status, created_at DESC)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_type ON score_submissions(event_id, score_type, created_at DESC)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_game_queue ON score_submissions(game_queue_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_bracket_game ON score_submissions(bracket_game_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_submissions_seeding_score ON score_submissions(seeding_score_id)`,
  );

  // Other indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
  );

  // Documentation score indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_event ON event_documentation_categories(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_category ON event_documentation_categories(category_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id)`,
  );

  // Awards indexes
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
  );
}
