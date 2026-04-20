import type { TableDefinition } from './types';

export const documentationSubScoresTable: TableDefinition = {
  name: 'documentation_sub_scores',
  pg: `
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
  `,
  sqlite: `
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
  `,
};
