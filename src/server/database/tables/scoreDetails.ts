import type { TableDefinition } from './types';

export const scoreDetailsTable: TableDefinition = {
  name: 'score_details',
  pg: `
    CREATE TABLE IF NOT EXISTS score_details (
      id SERIAL PRIMARY KEY,
      score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL,
      field_value TEXT,
      calculated_value INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS score_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL,
      field_value TEXT,
      calculated_value INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};
