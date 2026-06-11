import type { SchemaModule } from './types';

export const documentationSchema: SchemaModule = {
  name: 'documentation',
  updatedAtTables: ['documentation_scores'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS documentation_categories (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          weight REAL NOT NULL DEFAULT 1.0,
          max_score REAL NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_documentation_categories (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, ordinal),
          UNIQUE(event_id, category_id)
        )
      `,
      `
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
      `
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
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_event ON event_documentation_categories(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_category ON event_documentation_categories(category_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS documentation_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          weight REAL NOT NULL DEFAULT 1.0,
          max_score REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_documentation_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, ordinal),
          UNIQUE(event_id, category_id)
        )
      `,
      `
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
      `
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
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_event ON event_documentation_categories(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_category ON event_documentation_categories(category_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id)`,
    ],
  },
};
