import type { TableDefinition } from './types';

export const bracketEntriesTable: TableDefinition = {
  name: 'bracket_entries',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
