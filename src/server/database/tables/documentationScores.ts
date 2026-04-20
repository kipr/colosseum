import type { TableDefinition } from './types';

export const documentationScoresTable: TableDefinition = {
  name: 'documentation_scores',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
