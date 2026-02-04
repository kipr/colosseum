import { getDatabase, Database } from './connection';
import fs from 'fs';
import path from 'path';

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

// TODO Update Postres schema
async function initializePostgres(db: Database): Promise<void> {
  // PostgreSQL schema

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

  // Add last_activity column if it doesn't exist (migration for existing databases)
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

  // Add auto_accept column if it doesn't exist (migration)
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

  // Score submissions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      spreadsheet_config_id INTEGER NOT NULL REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      participant_name TEXT,
      match_id TEXT,
      score_data TEXT NOT NULL,
      submitted_to_sheet BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  // Create indexes
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
      is_admin BOOLEAN DEFAULT 0,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add last_activity column if it doesn't exist (migration)
  try {
    await db.exec(
      `ALTER TABLE users ADD COLUMN last_activity DATETIME DEFAULT CURRENT_TIMESTAMP`,
    );
  } catch {
    // Column might already exist
  }

  // Spreadsheet configurations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT,
      is_active BOOLEAN DEFAULT 1,
      auto_accept BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Add sheet_purpose column if it doesn't exist
  try {
    await db.exec(
      `ALTER TABLE spreadsheet_configs ADD COLUMN sheet_purpose TEXT DEFAULT 'scores'`,
    );
    console.log('✅ Added sheet_purpose column to spreadsheet_configs');
  } catch {
    // Column already exists
  }

  // Add auto_accept column if it doesn't exist
  try {
    await db.exec(
      `ALTER TABLE spreadsheet_configs ADD COLUMN auto_accept BOOLEAN DEFAULT 0`,
    );
    console.log('✅ Added auto_accept column to spreadsheet_configs');
  } catch {
    // Column already exists
  }

  // Add token_expires_at column to users table
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN token_expires_at INTEGER`);
    console.log('✅ Added token_expires_at column to users');
  } catch {
    // Column already exists
  }

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

  // Migration: Remove type column if it exists
  try {
    const tableInfo = await db.all(
      'PRAGMA table_info(scoresheet_field_templates)',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasTypeColumn = tableInfo.some((col: any) => col.name === 'type');

    if (hasTypeColumn) {
      console.log(
        '⚙️ Migrating scoresheet_field_templates to remove type column...',
      );
      await db.exec(`
        CREATE TABLE scoresheet_field_templates_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          fields_json TEXT NOT NULL,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO scoresheet_field_templates_new (id, name, description, fields_json, created_by, created_at, updated_at)
        SELECT id, name, description, fields_json, created_by, created_at, updated_at 
        FROM scoresheet_field_templates;
        DROP TABLE scoresheet_field_templates;
        ALTER TABLE scoresheet_field_templates_new RENAME TO scoresheet_field_templates;
      `);
      console.log('✅ Scoresheet field templates table migrated successfully');
    } else {
      console.log(
        '✅ Scoresheet field templates table ready (no migration needed)',
      );
    }
  } catch {
    console.log('✅ Scoresheet field templates table ready');
  }

  // Scoresheet templates
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      created_by INTEGER,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Add access_code column if it doesn't exist
  try {
    await db.exec(
      `ALTER TABLE scoresheet_templates ADD COLUMN access_code TEXT`,
    );
  } catch {
    /* Column already exists */
  }

  // Add spreadsheet_config_id column if it doesn't exist
  try {
    await db.exec(
      `ALTER TABLE scoresheet_templates ADD COLUMN spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id)`,
    );
    console.log(
      '✅ Added spreadsheet_config_id column to scoresheet_templates',
    );
  } catch {
    /* Column already exists */
  }

  // Score submissions (enhanced with event/bracket context from spec)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS score_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      template_id INTEGER NOT NULL,
      spreadsheet_config_id INTEGER NOT NULL,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Update score_submissions if needed
  try {
    const tableInfo = await db.all('PRAGMA table_info(score_submissions)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasStatus = tableInfo.some((col: any) => col.name === 'status');
    const hasReviewedBy = tableInfo.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (col: any) => col.name === 'reviewed_by',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userIdColumn = tableInfo.find((col: any) => col.name === 'user_id');

    if (
      !hasStatus ||
      !hasReviewedBy ||
      (userIdColumn && userIdColumn.notnull === 1)
    ) {
      await db.exec(`
        CREATE TABLE score_submissions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          template_id INTEGER NOT NULL,
          spreadsheet_config_id INTEGER NOT NULL,
          participant_name TEXT,
          match_id TEXT,
          score_data TEXT NOT NULL,
          submitted_to_sheet BOOLEAN DEFAULT 0,
          status TEXT DEFAULT 'pending',
          reviewed_by INTEGER,
          reviewed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO score_submissions_new (id, user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, submitted_to_sheet, created_at, updated_at)
        SELECT id, user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, submitted_to_sheet, created_at, updated_at FROM score_submissions;
        DROP TABLE score_submissions;
        ALTER TABLE score_submissions_new RENAME TO score_submissions;
      `);
      console.log('✅ Updated score_submissions table with review columns');
    }
  } catch {
    /* Migration error */
  }

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
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'complete', 'archived')),
      seeding_rounds INTEGER DEFAULT 3,
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
        CHECK (status IN ('registered', 'checked_in', 'no_show', 'withdrawn')),
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
        CHECK (status IN ('setup', 'in_progress', 'completed')),
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
        CHECK (bracket_side IN ('winners', 'losers', 'finals')),
      team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team1_source TEXT,
      team2_source TEXT,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
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
      UNIQUE(event_id, template_id)
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
      queue_type TEXT NOT NULL CHECK (queue_type IN ('seeding', 'bracket')),
      queue_position INTEGER NOT NULL,
      status TEXT DEFAULT 'queued'
        CHECK (status IN ('queued', 'called', 'in_progress', 'completed', 'skipped')),
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

  // Create indexes (commented out for now)
  /*
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`);
  */
}
