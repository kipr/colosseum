import type { TableDefinition } from './types';

export const seedingScoresTable: TableDefinition = {
  name: 'seeding_scores',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
