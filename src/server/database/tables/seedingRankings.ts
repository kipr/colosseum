import type { TableDefinition } from './types';

export const seedingRankingsTable: TableDefinition = {
  name: 'seeding_rankings',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
