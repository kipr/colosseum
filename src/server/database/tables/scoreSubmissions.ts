import type { TableDefinition } from './types';

/**
 * Note: `score_submissions` is created before `bracket_games` and `game_queue`
 * in the table order, so its FKs to those two tables are added by migrations
 * `0008_score_submissions_bracket_game_fk` and `0009_score_submissions_game_queue_fk`
 * on Postgres. The SQLite baseline declares them inline because SQLite parses
 * forward references lazily.
 */
export const scoreSubmissionsTable: TableDefinition = {
  name: 'score_submissions',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
