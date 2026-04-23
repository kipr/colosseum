/**
 * Dialect-aware CREATE TABLE definitions.
 *
 * Each table is one function that renders its `CREATE TABLE IF NOT EXISTS …`
 * statement for the given dialect. `ALL_TABLES` lists them in
 * FK-dependency order so a single loop can apply them on Postgres (where
 * `REFERENCES` requires the target table to exist) and SQLite alike.
 *
 * A few tables (`score_submissions`, `bracket_games`) form circular FK
 * relationships. SQLite tolerates forward references when `foreign_keys=ON`
 * (FKs are checked at insert time), so we keep the inline FK clauses on
 * SQLite only and rely on the discrete deferred-FK migrations on Postgres.
 */

import {
  Dialect,
  bigint,
  boolDefault,
  boolLit,
  bracketSideCheck,
  bracketStatusCheck,
  eventStatusCheck,
  gameStatusCheck,
  idColumn,
  queueStatusCheck,
  queueTypeCheck,
  scoreAcceptModeCheck,
  teamStatusCheck,
  timestamp,
} from '../dialect';

// SQLite-only inline REFERENCES for circular FKs (Postgres adds these later
// via deferred-FK migrations).
function inlineRefIfSqlite(d: Dialect, ref: string): string {
  return d === 'sqlite' ? ref : '';
}

export const usersTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS users (
    id ${idColumn(d)},
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at ${bigint(d)},
    is_admin ${boolDefault(d, false)},
    last_activity ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const spreadsheetConfigsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS spreadsheet_configs (
    id ${idColumn(d)},
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL,
    spreadsheet_name TEXT,
    sheet_name TEXT,
    sheet_purpose TEXT DEFAULT 'scores',
    is_active ${boolDefault(d, true)},
    auto_accept ${boolDefault(d, false)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const scoresheetFieldTemplatesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
    id ${idColumn(d)},
    name TEXT NOT NULL,
    description TEXT,
    fields_json TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const scoresheetTemplatesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS scoresheet_templates (
    id ${idColumn(d)},
    name TEXT NOT NULL,
    description TEXT,
    schema TEXT NOT NULL,
    access_code TEXT NOT NULL,
    spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_active ${boolDefault(d, true)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const eventsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS events (
    id ${idColumn(d)},
    name TEXT NOT NULL,
    description TEXT,
    event_date DATE,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'setup' ${eventStatusCheck},
    seeding_rounds INTEGER DEFAULT 3,
    score_accept_mode TEXT NOT NULL DEFAULT 'manual' ${scoreAcceptModeCheck},
    spectator_results_released INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const teamsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS teams (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_number INTEGER NOT NULL CHECK (team_number > 0),
    team_name TEXT NOT NULL,
    display_name TEXT,
    status TEXT DEFAULT 'registered'
      ${teamStatusCheck},
    checked_in_at ${timestamp(d)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, team_number)
  )
`;

export const seedingScoresTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS seeding_scores (
    id ${idColumn(d)},
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL CHECK (round_number > 0),
    score INTEGER,
    score_submission_id INTEGER ${inlineRefIfSqlite(d, 'REFERENCES score_submissions(id) ON DELETE SET NULL')},
    scored_at ${timestamp(d)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, round_number)
  )
`;

export const seedingRankingsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS seeding_rankings (
    id ${idColumn(d)},
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    seed_average REAL,
    seed_rank INTEGER CHECK (seed_rank > 0),
    raw_seed_score REAL,
    tiebreaker_value REAL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id)
  )
`;

export const documentationCategoriesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS documentation_categories (
    id ${idColumn(d)},
    name TEXT NOT NULL UNIQUE,
    weight REAL NOT NULL DEFAULT 1.0,
    max_score REAL NOT NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const eventDocumentationCategoriesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS event_documentation_categories (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, ordinal),
    UNIQUE(event_id, category_id)
  )
`;

export const documentationScoresTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS documentation_scores (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    overall_score REAL,
    scored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scored_at ${timestamp(d)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, team_id)
  )
`;

export const documentationSubScoresTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS documentation_sub_scores (
    id ${idColumn(d)},
    documentation_score_id INTEGER NOT NULL
      REFERENCES documentation_scores(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL
      REFERENCES documentation_categories(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(documentation_score_id, category_id)
  )
`;

export const bracketsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS brackets (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bracket_size INTEGER NOT NULL,
    actual_team_count INTEGER,
    status TEXT DEFAULT 'setup'
      ${bracketStatusCheck},
    weight REAL NOT NULL DEFAULT 1.0
      CHECK (weight > 0 AND weight <= 1),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const bracketEntriesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS bracket_entries (
    id ${idColumn(d)},
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    seed_position INTEGER NOT NULL,
    initial_slot INTEGER,
    is_bye ${boolDefault(d, false)},
    final_rank INTEGER,
    bracket_raw_score REAL,
    weighted_bracket_raw_score REAL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bracket_id, team_id),
    UNIQUE(bracket_id, seed_position),
    CHECK (
      (is_bye = ${boolLit(d, true)} AND team_id IS NULL) OR
      (is_bye = ${boolLit(d, false)} AND team_id IS NOT NULL)
    )
  )
`;

// score_submissions has circular FK relationships with bracket_games and
// game_queue. On SQLite we keep inline REFERENCES (forward refs are allowed
// when foreign_keys=ON, since FKs are checked at insert time). On Postgres
// the constraint requires the target table to exist; we add it later via
// deferred-FK migrations.
export const scoreSubmissionsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS score_submissions (
    id ${idColumn(d)},
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
    spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id) ON DELETE ${d === 'postgres' ? 'CASCADE' : 'SET NULL'},
    participant_name TEXT,
    match_id TEXT,
    score_data TEXT NOT NULL,
    submitted_to_sheet ${boolDefault(d, false)},
    status TEXT DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at ${timestamp(d)},
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    bracket_game_id INTEGER ${inlineRefIfSqlite(d, 'REFERENCES bracket_games(id) ON DELETE SET NULL')},
    seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL,
    score_type TEXT,
    game_queue_id INTEGER ${inlineRefIfSqlite(d, 'REFERENCES game_queue(id) ON DELETE SET NULL')},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const bracketGamesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS bracket_games (
    id ${idColumn(d)},
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    game_number INTEGER NOT NULL,
    round_name TEXT,
    round_number INTEGER,
    bracket_side TEXT
      ${bracketSideCheck},
    team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    team1_source TEXT,
    team2_source TEXT,
    status TEXT DEFAULT 'pending'
      ${gameStatusCheck},
    winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    winner_advances_to_id INTEGER REFERENCES bracket_games(id),
    loser_advances_to_id INTEGER REFERENCES bracket_games(id),
    winner_slot TEXT,
    loser_slot TEXT,
    team1_score INTEGER,
    team2_score INTEGER,
    score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
    scheduled_time ${timestamp(d)},
    started_at ${timestamp(d)},
    completed_at ${timestamp(d)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bracket_id, game_number)
  )
`;

export const scoreDetailsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS score_details (
    id ${idColumn(d)},
    score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL,
    field_value TEXT,
    calculated_value INTEGER,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const eventScoresheetTemplatesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
    template_type TEXT NOT NULL
      CHECK (template_type IN ('seeding', 'bracket')),
    is_default ${boolDefault(d, false)},
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, template_id, template_type)
  )
`;

export const gameQueueTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS game_queue (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
    seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    seeding_round INTEGER,
    queue_type TEXT NOT NULL ${queueTypeCheck},
    queue_position INTEGER NOT NULL,
    status TEXT DEFAULT 'queued'
      ${queueStatusCheck},
    called_at ${timestamp(d)},
    table_number INTEGER,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    CHECK (
      (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
      OR
      (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
    )
  )
`;

export const bracketTemplatesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS bracket_templates (
    id ${idColumn(d)},
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
    is_championship ${boolDefault(d, false)},
    is_grand_final ${boolDefault(d, false)},
    is_reset_game ${boolDefault(d, false)},
    UNIQUE(bracket_size, game_number)
  )
`;

export const auditLogTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS audit_log (
    id ${idColumn(d)},
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const activeSessionsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS active_sessions (
    id ${idColumn(d)},
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,
    last_activity ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const chatMessagesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS chat_messages (
    id ${idColumn(d)},
    spreadsheet_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    is_admin ${boolDefault(d, false)},
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

// Postgres-only: session store table for connect-pg-simple.
export const sessionTablePostgres = (): string => `
  CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL COLLATE "default",
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
  )
`;

export const awardTemplatesTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS award_templates (
    id ${idColumn(d)},
    name TEXT NOT NULL,
    description TEXT,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const eventAwardsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS event_awards (
    id ${idColumn(d)},
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_award_id INTEGER REFERENCES award_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP
  )
`;

export const eventAwardRecipientsTable = (d: Dialect): string => `
  CREATE TABLE IF NOT EXISTS event_award_recipients (
    id ${idColumn(d)},
    event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at ${timestamp(d)} DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_award_id, team_id)
  )
`;

/**
 * Ordered list of every table definition. Order respects FK dependencies
 * (Postgres requires referenced tables to exist; SQLite forward refs are
 * fine). Postgres-only tables are appended via `POSTGRES_ONLY_TABLES`.
 */
export const ALL_TABLES: ReadonlyArray<(d: Dialect) => string> = [
  usersTable,
  spreadsheetConfigsTable,
  scoresheetFieldTemplatesTable,
  scoresheetTemplatesTable,
  eventsTable,
  teamsTable,
  seedingScoresTable,
  seedingRankingsTable,
  documentationCategoriesTable,
  eventDocumentationCategoriesTable,
  documentationScoresTable,
  documentationSubScoresTable,
  bracketsTable,
  bracketEntriesTable,
  scoreSubmissionsTable,
  bracketGamesTable,
  scoreDetailsTable,
  eventScoresheetTemplatesTable,
  gameQueueTable,
  bracketTemplatesTable,
  auditLogTable,
  activeSessionsTable,
  chatMessagesTable,
  awardTemplatesTable,
  eventAwardsTable,
  eventAwardRecipientsTable,
];

/**
 * Tables that exist only in the Postgres schema (e.g. session store).
 */
export const POSTGRES_ONLY_TABLES: ReadonlyArray<() => string> = [
  sessionTablePostgres,
];
